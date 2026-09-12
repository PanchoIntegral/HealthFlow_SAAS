import { Inject, Injectable } from '@nestjs/common';
import type { AppEventType } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import type { AppEventConsumer, AppEventEnvelope } from '../../../common/events/app-event.types';
import { ReactivacionNoConfiguradaError, TipoRecallInactivoError } from '../domain/recall.errors';
import {
  GenerateRecallFromCompletedTreatmentUseCase,
  GenerateRecallFromNoShowUseCase,
} from './recall-asignacion.use-cases';
import {
  MatchAppointmentToRecallUseCase,
  UpdateRecallOnAppointmentUseCase,
} from './recall-ciclo.use-cases';

/**
 * Consumidores de Recall.
 *
 * Los NOMBRES son clave de idempotencia junto con el id del evento
 * (`app_event_consumptions`), así que llevan versión y NO se renombran después
 * de desplegar: con otro nombre, un consumidor reprocesaría desde cero toda la
 * historia de eventos que quepa en la ventana de reconciliación.
 *
 * Ninguno escribe SQL: delegan en los casos de uso, que son los que controlan
 * transacción, capacidad efectiva y auditoría. El despachador ya aplaza el
 * evento cuando la clínica no tiene el módulo disponible (`moduloRequerido`),
 * así que aquí no hay que comprobarlo otra vez.
 */

const MODULO = 'dental_recalls' as const;

/** Un tratamiento terminado abre el siguiente ciclo. */
@Injectable()
export class GenerarRecallPorTratamientoConsumer implements AppEventConsumer {
  readonly nombre = 'recalls.generar.tratamiento.v1';
  readonly tipos: readonly AppEventType[] = ['treatment_item.completed'];
  readonly moduloRequerido = MODULO;

  constructor(private readonly caso: GenerateRecallFromCompletedTreatmentUseCase) {}

  async manejar(evento: AppEventEnvelope, tx: Tx): Promise<void> {
    const p = evento.payload as {
      patientId?: string;
      doctorId?: string | null;
      presupuestoId?: string;
    };
    if (!p.patientId || !evento.entidadId) return;
    await this.caso.ejecutar(tx, {
      tenantId: evento.tenantId,
      patientId: p.patientId,
      partidaId: evento.entidadId,
      doctorId: p.doctorId ?? null,
      // La fecha del HECHO, no la de hoy: un evento reconciliado con retraso
      // no debe correr el vencimiento del control.
      ocurrioEn: evento.occurredAt,
    });
  }
}

/** Una cita nueva cierra el seguimiento que la motivó. */
@Injectable()
export class VincularCitaConRecallConsumer implements AppEventConsumer {
  readonly nombre = 'recalls.vincular.cita.v1';
  readonly tipos: readonly AppEventType[] = ['appointment.scheduled'];
  readonly moduloRequerido = MODULO;

  constructor(private readonly caso: MatchAppointmentToRecallUseCase) {}

  async manejar(evento: AppEventEnvelope, tx: Tx): Promise<void> {
    const p = evento.payload as { patientId?: string; serviceId?: string | null };
    if (!p.patientId || !evento.entidadId) return;
    await this.caso.ejecutar(tx, {
      tenantId: evento.tenantId,
      patientId: p.patientId,
      appointmentId: evento.entidadId,
      // Sin servicio no hay asociación automática. Es el caso de la cita
      // interna, que recepción agenda a mano: exige vínculo manual.
      serviceId: p.serviceId ?? null,
    });
  }
}

/**
 * El ciclo de la cita vinculada.
 *
 * Los tres eventos hacen cosas distintas a propósito:
 *  - `completed`   → el control se cierra;
 *  - `cancelled`   → vuelve a `due`, hay que volver a buscar al paciente;
 *  - `rescheduled` → NO cambia nada. La cita sigue existiendo, sólo cambió de
 *    hora; reabrir el seguimiento mandaría un mensaje a alguien que ya tiene
 *    cita. Se consume igualmente para dejarlo explícito: que este consumidor
 *    lo escuche y decida no hacer nada es distinto de que nadie lo escuche.
 */
@Injectable()
export class CicloDeCitaConsumer implements AppEventConsumer {
  readonly nombre = 'recalls.ciclo.cita.v1';
  readonly tipos: readonly AppEventType[] = [
    'appointment.cancelled',
    'appointment.completed',
    'appointment.rescheduled',
  ];
  readonly moduloRequerido = MODULO;

  constructor(private readonly caso: UpdateRecallOnAppointmentUseCase) {}

  async manejar(evento: AppEventEnvelope, tx: Tx): Promise<void> {
    if (!evento.entidadId) return;
    if (evento.tipo === 'appointment.rescheduled') return;
    if (evento.tipo === 'appointment.completed') {
      await this.caso.completar(tx, {
        tenantId: evento.tenantId,
        appointmentId: evento.entidadId,
        ahora: evento.occurredAt,
      });
      return;
    }
    await this.caso.reabrir(tx, {
      tenantId: evento.tenantId,
      appointmentId: evento.entidadId,
    });
  }
}

/** Una inasistencia abre un seguimiento de reactivación, si está configurado. */
@Injectable()
export class ReactivarPorNoShowConsumer implements AppEventConsumer {
  readonly nombre = 'recalls.reactivar.no_show.v1';
  readonly tipos: readonly AppEventType[] = ['appointment.no_show'];
  readonly moduloRequerido = MODULO;

  constructor(private readonly caso: GenerateRecallFromNoShowUseCase) {}

  async manejar(evento: AppEventEnvelope, tx: Tx): Promise<void> {
    const p = evento.payload as { patientId?: string };
    if (!p.patientId || !evento.entidadId) return;
    try {
      await this.caso.ejecutar(tx, {
        tenantId: evento.tenantId,
        patientId: p.patientId,
        appointmentId: evento.entidadId,
        ocurrioEn: evento.occurredAt,
      });
    } catch (error) {
      // Que la clínica no haya configurado la reactivación —o que el tipo
      // elegido se haya desactivado después— NO es un fallo del evento: es su
      // decisión. Reintentarlo ocho veces hasta dejarlo 'dead' llenaría las
      // alertas de algo que está bien.
      if (
        error instanceof ReactivacionNoConfiguradaError ||
        error instanceof TipoRecallInactivoError
      ) {
        return;
      }
      throw error;
    }
  }
}
