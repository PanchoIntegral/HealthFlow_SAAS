import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { runInTenant, type Database } from '../../../db/drizzle';
import { DB } from '../../../db/drizzle.module';
import {
  WHATSAPP_CONFIG_REPOSITORY,
  type WhatsappConfigRepository,
} from '../domain/whatsapp-config.repository';
import {
  WHATSAPP_OUTBOX_REPOSITORY,
  type WhatsappOutboxRepository,
} from '../domain/whatsapp-outbox.repository';
import { calcularProgramadoPara } from '../domain/ventana-recordatorio';

/**
 * Fase 1 del barrido: convierte las citas próximas en filas del outbox.
 *
 * Corre FUERA de toda petición, así que no hay tenant fijado. La lista de
 * clínicas la da `whatsapp_tenants_activos()` —una función SECURITY DEFINER que
 * devuelve solo uuids— y cada una se procesa dentro de su propio
 * `runInTenant`: leer citas y pacientes ocurre ya bajo RLS, con el mismo
 * aislamiento que una petición HTTP normal.
 */
@Injectable()
export class MaterializarRecordatoriosUseCase {
  private readonly logger = new Logger(MaterializarRecordatoriosUseCase.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly configRepo: WhatsappConfigRepository,
    @Inject(WHATSAPP_OUTBOX_REPOSITORY) private readonly outbox: WhatsappOutboxRepository,
  ) {}

  /** Devuelve cuántos recordatorios nuevos se encolaron. */
  async execute(ahora: Date = new Date()): Promise<number> {
    const tenants = await this.tenantsActivos();
    let encolados = 0;

    for (const tenantId of tenants) {
      try {
        encolados += await this.materializarTenant(tenantId, ahora);
      } catch (error) {
        // Una clínica con datos raros no debe dejar sin recordatorios a las
        // demás: se registra y el barrido sigue.
        this.logger.error(
          `No se pudieron materializar los recordatorios del tenant ${tenantId}: ${mensaje(error)}`,
        );
      }
    }
    return encolados;
  }

  /**
   * Las clínicas con recordatorios encendidos. La función es SECURITY DEFINER
   * y devuelve SOLO uuids: `tenants` tiene FORCE ROW LEVEL SECURITY y sin
   * tenant fijado no entregaría ninguna fila.
   */
  private async tenantsActivos(): Promise<string[]> {
    const result = await this.db.execute(sql`SELECT tenant_id FROM whatsapp_tenants_activos()`);
    return (result.rows as unknown as { tenant_id: string }[]).map((f) => f.tenant_id);
  }

  private async materializarTenant(tenantId: string, ahora: Date): Promise<number> {
    return runInTenant(this.db, tenantId, async (tx) => {
      const config = await this.configRepo.find(tx, tenantId);
      // La función definer ya filtró por `activo`, pero entre esa lectura y
      // esta transacción la clínica pudo apagarlos.
      if (!config?.activo) return 0;

      const hasta = new Date(ahora.getTime() + config.horasAnticipacion * 60 * 60 * 1000);
      const citas = await this.outbox.citasSinRecordatorio(
        tx,
        'recordatorio_cita',
        hasta,
        ahora,
      );

      const silencio = {
        desdeHora: config.silencioDesde,
        hastaHora: config.silencioHasta,
        tz: config.zonaHoraria,
      };

      let encolados = 0;
      for (const cita of citas) {
        const programadoPara = calcularProgramadoPara(
          cita.inicioProgramado,
          config.horasAnticipacion,
          ahora,
          silencio,
        );
        // null = la cita es demasiado próxima. El paciente acaba de hablar con
        // la clínica; no hay nada que recordarle.
        if (programadoPara === null) continue;

        const creado = await this.outbox.encolar(tx, {
          patientId: cita.patientId,
          appointmentId: cita.appointmentId,
          plantilla: 'recordatorio_cita',
          variables: variablesDeRecordatorio(config.nombreRemitente ?? '', cita, config.zonaHoraria),
          programadoPara,
        });
        if (creado) encolados++;
      }
      return encolados;
    });
  }
}

/**
 * Variables del cuerpo de la plantilla.
 *
 * NADA de información clínica: el nombre del paciente, la clínica, la fecha, la
 * hora y el médico sí; el motivo de la consulta NO. Un WhatsApp lo puede leer
 * cualquiera que tenga el teléfono en la mano.
 */
export function variablesDeRecordatorio(
  nombreClinica: string,
  cita: { pacienteNombre: string; doctorNombre: string; inicioProgramado: Date },
  tz: string,
): Record<string, string> {
  return {
    '1': primerNombre(cita.pacienteNombre),
    '2': nombreClinica,
    '3': fechaLegible(cita.inicioProgramado, tz),
    '4': horaLegible(cita.inicioProgramado, tz),
    '5': cita.doctorNombre,
  };
}

/** «José Antonio Ramírez» → «José». El mensaje se lee mejor y expone menos. */
function primerNombre(nombre: string): string {
  return nombre.trim().split(/\s+/)[0] ?? nombre;
}

function fechaLegible(fecha: Date, tz: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(fecha);
}

function horaLegible(fecha: Date, tz: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(fecha);
}

function mensaje(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
