import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { StartConsultationResponse, WaitingRoomEntry } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { AuditService } from '../../../common/audit/audit.service';
import {
  APPOINTMENT_REPOSITORY,
  type AppointmentRepository,
} from '../../appointments/domain/appointment.repository';
import {
  WAITING_ROOM_NOTIFIER,
  type WaitingRoomNotifier,
} from '../../appointments/application/waiting-room-notifier.port';
import {
  CLINICAL_RECORD_REPOSITORY,
  type ClinicalRecordRepository,
} from '../domain/clinical-record.repository';

/**
 * Inicio de consulta: en_espera → en_consulta. Efecto clave: crea el borrador
 * de nota clínica ligado a la cita y abre el expediente del paciente. Todo en
 * una transacción; el evento realtime se emite tras confirmarla.
 *
 * Idempotente ante reingreso: si el médico sale del editor y vuelve a entrar
 * (la cita ya está en_consulta), NO se repite la transición de dominio — solo
 * se reabre/reusa la nota existente. Cualquier otro estado de origen (p.ej.
 * 'agendada' o 'finalizada') sigue siendo rechazado por la máquina de estados.
 */
@Injectable()
export class StartConsultationUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    private readonly audit: AuditService,
    @Inject(APPOINTMENT_REPOSITORY) private readonly appointments: AppointmentRepository,
    @Inject(CLINICAL_RECORD_REPOSITORY) private readonly records: ClinicalRecordRepository,
    @Inject(WAITING_ROOM_NOTIFIER) private readonly notifier: WaitingRoomNotifier,
  ) {}

  async execute(appointmentId: string): Promise<StartConsultationResponse> {
    const { entry, response, previousStatus } = await this.tenantDb.run(async (tx) => {
      const appointment = await this.appointments.findById(tx, appointmentId);
      if (!appointment) throw new NotFoundException('Cita no encontrada');

      const previousStatus = appointment.estatus;
      const isReentry = previousStatus === 'en_consulta';

      if (!isReentry) {
        appointment.startConsultation(); // regla de dominio: en_espera → en_consulta
        await this.appointments.save(tx, appointment);
      }

      const state = appointment.toState();
      const recordId = await this.records.ensureRecordForPatient(tx, state.patientId);

      // Reusa la nota si ya existía (reingreso al editor); si no, crea el borrador.
      const existing = await this.records.findNoteByAppointment(tx, appointmentId);
      const noteId =
        existing?.id ??
        (await this.records.createDraftNote(tx, {
          clinicalRecordId: recordId,
          appointmentId,
          doctorId: state.doctorId,
        }));

      await this.audit.record(tx, {
        entidad: 'clinical_note',
        entidadId: noteId,
        accion: 'open_consultation',
        detalle: { appointmentId, patientId: state.patientId },
      });

      const view = await this.appointments.findWaitingRoomEntry(tx, appointmentId);
      return {
        entry: view as WaitingRoomEntry,
        previousStatus,
        response: { appointmentId, noteId, patientId: state.patientId },
      };
    });

    this.notifier.appointmentUpdated(this.ctx.get().tenantId, {
      entry,
      previousStatus,
    });
    return response;
  }
}
