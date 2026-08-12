import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { esAvanceDeEstado, type WhatsappEstadoOutbox } from '@healthflow/shared-types';
import { runInTenant, type Database, type Tx } from '../../../db/drizzle';
import { DB } from '../../../db/drizzle.module';
import { AuditService } from '../../../common/audit/audit.service';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { SystemContextRunner } from '../../../common/tenant-context/system-context.runner';
import { CancelAppointmentUseCase } from '../../appointments/application/cancel-appointment.use-case';
import {
  APPOINTMENT_REPOSITORY,
  type AppointmentRepository,
} from '../../appointments/domain/appointment.repository';
import {
  WHATSAPP_OUTBOX_REPOSITORY,
  type WhatsappOutboxRepository,
} from '../domain/whatsapp-outbox.repository';
import { parsearWebhook, type EventoWhatsapp } from '../domain/webhook-payload';
import { ReagendaTokensService } from './reagenda-tokens.service';
import { env } from '../../../config/env';

/** Lo que resuelve la función definer a partir del id de mensaje de Meta. */
interface Ruta {
  tenantId: string;
  outboxId: string;
}

/**
 * Procesa los eventos que manda Meta.
 *
 * Corre DESPUÉS de responder 200 al webhook, disparado por el scheduler al
 * drenar `whatsapp_events`. Nada de lo que pase aquí puede hacer que Meta
 * reintente de inmediato: la durabilidad la da `processed_at`, que solo se
 * marca cuando el evento se procesó entero.
 *
 * La regla que gobierna todo el archivo: **el tenant se resuelve SIEMPRE por
 * `context.id` → `meta_message_id`**, nunca por el teléfono del remitente. Un
 * mismo celular puede ser paciente en dos clínicas; resolver por número
 * entregaría la cita equivocada saltándose el RLS.
 */
@Injectable()
export class ProcesarWebhookUseCase {
  private readonly logger = new Logger(ProcesarWebhookUseCase.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(WHATSAPP_OUTBOX_REPOSITORY) private readonly outbox: WhatsappOutboxRepository,
    @Inject(APPOINTMENT_REPOSITORY) private readonly citas: AppointmentRepository,
    private readonly systemCtx: SystemContextRunner,
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    private readonly cancelarCita: CancelAppointmentUseCase,
    private readonly tokens: ReagendaTokensService,
  ) {}

  async execute(payload: unknown, ahora: Date = new Date()): Promise<number> {
    const eventos = parsearWebhook(payload);
    let procesados = 0;

    for (const evento of eventos) {
      try {
        await this.procesar(evento, ahora);
        procesados++;
      } catch (error) {
        // Un evento que falla no debe impedir los demás del mismo lote: cada
        // uno es independiente y viene de un paciente distinto.
        this.logger.error(`Evento ${evento.tipo} no procesado: ${mensaje(error)}`);
      }
    }
    return procesados;
  }

  private async procesar(evento: EventoWhatsapp, ahora: Date): Promise<void> {
    switch (evento.tipo) {
      case 'estado':
        return this.aplicarEstado(evento.metaMessageId, evento.estado, evento.error);
      case 'boton':
        return this.aplicarBoton(evento.contextMessageId, evento.accion, ahora);
      case 'baja':
        return this.aplicarBaja(evento.contextMessageId, evento.deE164);
    }
  }

  /**
   * Resuelve el par (tenant, fila) desde el id de mensaje. `null` si no lo
   * conocemos: puede ser un mensaje de otra instalación o un intento de que
   * procesemos algo que no es nuestro.
   */
  private async ruta(metaMessageId: string): Promise<Ruta | null> {
    const result = await this.db.execute(
      sql`SELECT tenant_id, outbox_id FROM whatsapp_ruta_por_message_id(${metaMessageId})`,
    );
    const fila = result.rows[0] as { tenant_id: string; outbox_id: string } | undefined;
    return fila ? { tenantId: fila.tenant_id, outboxId: fila.outbox_id } : null;
  }

  private async aplicarEstado(
    metaMessageId: string,
    nuevo: WhatsappEstadoOutbox,
    error: string | null,
  ): Promise<void> {
    const ruta = await this.ruta(metaMessageId);
    if (!ruta) return;

    await runInTenant(this.db, ruta.tenantId, async (tx) => {
      const actual = await estadoActual(tx, ruta.outboxId);
      // Meta no garantiza el orden de entrega de sus webhooks: sin esta guarda
      // un 'delivered' tardío haría retroceder un mensaje ya leído.
      if (!actual || !esAvanceDeEstado(actual, nuevo)) return;
      await this.outbox.actualizarEstadoPorMessageId(tx, metaMessageId, nuevo, error);
    });
  }

  private async aplicarBoton(
    contextMessageId: string,
    accion: 'confirmar' | 'cancelar' | 'reagendar',
    ahora: Date,
  ): Promise<void> {
    const ruta = await this.ruta(contextMessageId);
    if (!ruta) {
      this.logger.warn('Respuesta a un mensaje desconocido: se ignora');
      return;
    }

    const appointmentId = await runInTenant(this.db, ruta.tenantId, async (tx) => {
      const fila = await this.outbox.findPendiente(tx, ruta.outboxId);
      return fila?.appointmentId ?? null;
    });
    if (!appointmentId) return;

    // Dentro del contexto de sistema los casos de uso escritos para peticiones
    // HTTP funcionan tal cual: encuentran tenant para RLS y actor para la
    // bitácora, que queda con user_id NULL y origen 'whatsapp'.
    await this.systemCtx.run(ruta.tenantId, async () => {
      switch (accion) {
        case 'confirmar':
          return this.confirmar(appointmentId, ahora);
        case 'cancelar':
          // Se reutiliza el caso de uso completo, no un UPDATE suelto: así el
          // médico recibe su notificación in-app y la sala de espera se
          // actualiza igual que si lo hubiera cancelado la recepcionista.
          await this.cancelarCita.execute(appointmentId, 'Cancelada por el paciente vía WhatsApp');
          return;
        case 'reagendar':
          await this.prepararReagenda(appointmentId, ahora);
          return;
      }
    });
  }

  private async confirmar(appointmentId: string, ahora: Date): Promise<void> {
    // `tenantDb.run` toma el tenant del contexto que abrió systemCtx.run().
    await this.tenantDb.run(async (tx) => {
      const cita = await this.citas.findById(tx, appointmentId);
      if (!cita) return;
      // Idempotente: Meta reintenta, y nada impide al paciente pulsar dos veces.
      cita.confirmar(ahora);
      await this.citas.save(tx, cita);
      await this.audit.record(tx, {
        entidad: 'appointment',
        entidadId: appointmentId,
        accion: 'confirm',
        detalle: { origen: 'whatsapp' },
      });
    });
  }

  /**
   * Emite el enlace de un solo uso con el que el paciente elige otro horario.
   *
   * Reagendar no cabe dentro de WhatsApp: solo hay tres botones y no hay forma
   * de mostrar un calendario. El enlace se guarda en el outbox como variable
   * del mensaje de respuesta, que sale en el siguiente barrido.
   */
  private async prepararReagenda(appointmentId: string, ahora: Date): Promise<string | null> {
    return this.tenantDb.run(async (tx) => {
      const cita = await this.citas.findById(tx, appointmentId);
      if (!cita) return null;

      const inicio = await inicioDeLaCita(tx, appointmentId);
      if (!inicio) return null;

      const token = await this.tokens.emitir(tx, appointmentId, inicio, ahora);

      await this.audit.record(tx, {
        entidad: 'appointment',
        entidadId: appointmentId,
        accion: 'reagenda_solicitada',
        detalle: { origen: 'whatsapp' },
      });
      return `${env.appUrl}/reagendar/${token}`;
    });
  }

  /**
   * Da de baja al paciente de los recordatorios.
   *
   * Aquí sí interviene el teléfono, y es el único caso: pero SOLO dentro del
   * tenant que ya resolvió `context.id`. Buscar ese número entre todos los
   * pacientes de todas las clínicas daría de baja a homónimos de otras.
   */
  private async aplicarBaja(contextMessageId: string | null, deE164: string): Promise<void> {
    if (!contextMessageId) {
      // Sin referencia a un mensaje nuestro no hay tenant que resolver, y no
      // se va a adivinar por el número.
      this.logger.warn('Petición de baja sin contexto: no se puede atribuir a una clínica');
      return;
    }
    const ruta = await this.ruta(contextMessageId);
    if (!ruta) return;

    await runInTenant(this.db, ruta.tenantId, async (tx) => {
      await tx.execute(sql`
        UPDATE patients
           SET whatsapp_opt_in = false, whatsapp_opt_in_at = NULL
         WHERE telefono_e164 = ${deE164}
      `);
      // Los mensajes ya encolados y aún sin salir se descartan: el paciente
      // pidió que dejen de escribirle, no "a partir del siguiente".
      await tx.execute(sql`
        UPDATE whatsapp_outbox o
           SET estado = 'fallido', ultimo_error = 'El paciente pidió no recibir más mensajes'
          FROM patients p
         WHERE p.id = o.patient_id
           AND p.telefono_e164 = ${deE164}
           AND o.estado = 'pendiente'
      `);
    });
    this.logger.log('Paciente dado de baja de los recordatorios a petición propia');
  }
}

async function inicioDeLaCita(tx: Tx, appointmentId: string): Promise<Date | null> {
  const r = await tx.execute(
    sql`SELECT inicio_programado FROM appointments WHERE id = ${appointmentId}`,
  );
  const fila = r.rows[0] as { inicio_programado: Date } | undefined;
  return fila ? new Date(fila.inicio_programado) : null;
}

async function estadoActual(tx: Tx, outboxId: string): Promise<WhatsappEstadoOutbox | null> {
  const r = await tx.execute(sql`SELECT estado FROM whatsapp_outbox WHERE id = ${outboxId}`);
  return (r.rows[0] as { estado: WhatsappEstadoOutbox } | undefined)?.estado ?? null;
}

function mensaje(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
