import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  FinishConsultationResponse,
  NotaEvolucionContent,
  WaitingRoomEntry,
} from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { AuditService } from '../../../common/audit/audit.service';
import { AppEventsService } from '../../../common/events/app-events.service';
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
 * Cierre de consulta: en_consulta → finalizada. Valida NOM-004 (dominio), cierra
 * la nota (inmutable, con firma), finaliza la cita. Atómico; emite realtime al
 * confirmar. Si faltan campos obligatorios lanza IncompleteClinicalNoteError (422).
 */
@Injectable()
export class FinishConsultationUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    private readonly audit: AuditService,
    private readonly eventos: AppEventsService,
    @Inject(APPOINTMENT_REPOSITORY) private readonly appointments: AppointmentRepository,
    @Inject(CLINICAL_RECORD_REPOSITORY) private readonly records: ClinicalRecordRepository,
    @Inject(WAITING_ROOM_NOTIFIER) private readonly notifier: WaitingRoomNotifier,
  ) {}

  async execute(
    appointmentId: string,
    contenido: NotaEvolucionContent,
  ): Promise<FinishConsultationResponse> {
    const { entry, response } = await this.tenantDb.run(async (tx) => {
      const note = await this.records.findNoteByAppointment(tx, appointmentId);
      if (!note) throw new NotFoundException('Nota no encontrada');

      const appointment = await this.appointments.findById(tx, appointmentId);
      if (!appointment) throw new NotFoundException('Cita no encontrada');

      const firma = await this.records.getDoctorSignature(tx, this.ctx.get().userId);
      const now = new Date();

      // Valida NOM-004 y cierra (inmutable). Lanza IncompleteClinicalNoteError si falta algo.
      note.close(
        contenido,
        { medicoNombre: firma.nombre, cedula: firma.cedula, fecha: now.toISOString() },
        now,
      );
      await this.records.saveNote(tx, note);

      appointment.finish(now); // en_consulta → finalizada
      await this.appointments.save(tx, appointment);

      await this.audit.record(tx, {
        entidad: 'clinical_note',
        entidadId: note.id,
        accion: 'close_note',
        detalle: { appointmentId },
      });

      // La cita se atendió de verdad: es lo que cierra el ciclo de un control
      // de Recall. Ojo con la diferencia — `treatment_item.completed` abre el
      // SIGUIENTE ciclo; esto cierra el actual.
      await this.eventos.emitir(tx, {
        tipo: 'appointment.completed',
        entidad: 'appointment',
        entidadId: appointmentId,
        payload: { patientId: appointment.patientId, doctorId: appointment.doctorId },
      });

      const view = await this.appointments.findWaitingRoomEntry(tx, appointmentId);
      const cerradoEn = note.cerradoEn!;
      return {
        entry: view as WaitingRoomEntry,
        response: {
          appointmentId,
          noteId: note.id,
          estatus: 'cerrada' as const,
          cerradoEn: cerradoEn.toISOString(),
        },
      };
    });

    this.notifier.appointmentUpdated(this.ctx.get().tenantId, {
      entry,
      previousStatus: 'en_consulta',
    });
    return response;
  }
}
