import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { CapacidadService } from '../../../common/capacidad/capacidad.service';
import type { Tx } from '../../../db/drizzle';
import { PatientRecall } from '../domain/recall.entity';
import { RECALL_REPOSITORY, type RecallRepository } from '../domain/recall.repository';
import { auditar, type ActorRecall } from './actor';

const MODULO = 'dental_recalls' as const;

/**
 * Vincula una cita nueva con el control que la motivó.
 *
 * La asociación es EXPLÍCITA: sólo cuando el servicio de la cita coincide con
 * el `booking_service_id` declarado por el tipo de control. Un tipo sin
 * servicio asociado exige vínculo manual — adivinar por proximidad de fechas
 * cerraría el control equivocado y la métrica de conversión mentiría, que es
 * justo la cifra con la que la clínica juzga el módulo.
 *
 * Si hay varios candidatos compatibles gana el más antiguo por `(due_date,
 * id)`, y la decisión queda en bitácora para poder revisarla.
 */
@Injectable()
export class MatchAppointmentToRecallUseCase {
  private readonly logger = new Logger(MatchAppointmentToRecallUseCase.name);

  constructor(
    private readonly capacidad: CapacidadService,
    private readonly audit: AuditService,
    @Inject(RECALL_REPOSITORY) private readonly repo: RecallRepository,
  ) {}

  async ejecutar(
    tx: Tx,
    input: {
      tenantId: string;
      patientId: string;
      appointmentId: string;
      serviceId: string | null;
    },
    actor: ActorRecall = { tipo: 'sistema', tenantId: '', origen: 'worker' },
  ): Promise<{ vinculado: string | null }> {
    await this.capacidad.asegurar(tx, MODULO, 'escritura');

    const candidatos = await this.repo.buscarVivosCompatibles(
      tx,
      input.patientId,
      input.serviceId,
    );
    const elegido = candidatos[0];
    if (!elegido) return { vinculado: null };

    const recall = PatientRecall.desde(elegido);
    recall.vincularCita(input.appointmentId);
    // Un control que ya se agendó no debe seguir recibiendo mensajes.
    await this.repo.cancelarPendientes(tx, elegido.id);
    await this.repo.guardar(tx, recall.snapshot);

    const efectivo: ActorRecall =
      actor.tipo === 'sistema' ? { ...actor, tenantId: input.tenantId } : actor;
    await auditar(this.audit, tx, efectivo, {
      entidad: 'PatientRecall',
      entidadId: elegido.id,
      accion: 'vincular_cita',
      detalle: { candidatos: candidatos.length, serviceId: input.serviceId },
    });
    if (candidatos.length > 1) {
      this.logger.log(
        `Cita ${input.appointmentId}: ${candidatos.length} controles compatibles, se vinculó el más antiguo`,
      );
    }
    return { vinculado: elegido.id };
  }
}

/**
 * Cierre y reapertura del ciclo según lo que pase con la cita vinculada.
 *
 * Los tres casos son deliberadamente distintos:
 *  - finalizada  → el control se completa (el siguiente ciclo lo abre la
 *    partida terminada, no esto);
 *  - cancelada   → vuelve a `due`: hay que volver a buscar al paciente;
 *  - reprogramada → NO cambia nada. La cita sigue existiendo, sólo cambió de
 *    hora; reabrir el seguimiento mandaría un mensaje a alguien que ya tiene
 *    cita.
 */
@Injectable()
export class UpdateRecallOnAppointmentUseCase {
  constructor(
    private readonly capacidad: CapacidadService,
    private readonly audit: AuditService,
    @Inject(RECALL_REPOSITORY) private readonly repo: RecallRepository,
  ) {}

  async completar(
    tx: Tx,
    input: { tenantId: string; appointmentId: string; ahora: Date },
  ): Promise<{ afectado: string | null }> {
    return this.aplicar(tx, input.tenantId, input.appointmentId, 'completar', (recall) =>
      recall.completar(input.ahora),
    );
  }

  async reabrir(
    tx: Tx,
    input: { tenantId: string; appointmentId: string },
  ): Promise<{ afectado: string | null }> {
    // `hayReemplazo=false` siempre: una reprogramación NO llega por aquí, sino
    // como `appointment.rescheduled`, que no toca el control.
    return this.aplicar(tx, input.tenantId, input.appointmentId, 'reabrir', (recall) =>
      recall.reabrirPorCancelacion(false),
    );
  }

  private async aplicar(
    tx: Tx,
    tenantId: string,
    appointmentId: string,
    accion: string,
    mutar: (recall: PatientRecall) => void,
  ): Promise<{ afectado: string | null }> {
    await this.capacidad.asegurar(tx, MODULO, 'escritura');
    const estado = await this.repo.buscarPorCita(tx, appointmentId);
    if (!estado) return { afectado: null };

    const recall = PatientRecall.desde(estado);
    mutar(recall);
    await this.repo.guardar(tx, recall.snapshot);
    await this.audit.recordSystem(
      tx,
      tenantId,
      {
        entidad: 'PatientRecall',
        entidadId: estado.id,
        accion,
        detalle: { status: recall.status },
      },
      'worker',
    );
    return { afectado: estado.id };
  }
}
