import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  plantillaDe,
  type FinishConsultationResponse,
  type NotaEvolucionContent,
  type WaitingRoomEntry,
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
import { NotaDeOtroMedicoError, NoteAlreadyClosedError } from '../domain/clinical-note.errors';
import { detalleCierreFallido } from '../domain/auditoria-nota';

/**
 * Cierre de consulta: en_consulta → finalizada. Valida NOM-004 (dominio), cierra
 * la nota (inmutable, con firma), finaliza la cita. Atómico; emite realtime al
 * confirmar. Si faltan campos obligatorios lanza IncompleteClinicalNoteError (422).
 */
@Injectable()
export class FinishConsultationUseCase {
  private readonly logger = new Logger(FinishConsultationUseCase.name);

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
    try {
      return await this.cerrar(appointmentId, contenido);
    } catch (error) {
      await this.auditarCierreFallido(appointmentId, error);
      throw error;
    }
  }

  /**
   * El rechazo revierte la transacción del cierre, y con ella cualquier
   * auditoría escrita dentro. Por eso el intento fallido se registra en una
   * transacción PROPIA, sólo con metadatos (ver detalleCierreFallido).
   *
   * Si registrar falla, se deja rastro técnico sin contenido y se propaga el
   * error ORIGINAL: el médico debe ver por qué no pudo firmar, no un error de
   * bitácora.
   */
  private async auditarCierreFallido(appointmentId: string, error: unknown): Promise<void> {
    const detalle = detalleCierreFallido(error, appointmentId);
    if (!detalle) return;
    try {
      await this.tenantDb.run(async (tx) => {
        const note = await this.records.findNoteByAppointment(tx, appointmentId);
        if (!note) return;
        await this.audit.record(tx, {
          entidad: 'clinical_note',
          entidadId: note.id,
          accion: 'close_note_failed',
          detalle: { ...detalle, plantillaVersion: plantillaDe(note.contenido) },
        });
      });
    } catch (fallo) {
      this.logger.warn(
        `No se pudo auditar el cierre fallido de la cita ${appointmentId}: ${fallo instanceof Error ? fallo.name : 'error'}`,
      );
    }
  }

  private async cerrar(
    appointmentId: string,
    contenido: NotaEvolucionContent,
  ): Promise<FinishConsultationResponse> {
    const { entry, response } = await this.tenantDb.run(async (tx) => {
      // FOR UPDATE: un autosave concurrente espera a que el cierre termine y
      // entonces su UPDATE condicionado ya no encuentra la nota en borrador.
      const note = await this.records.findNoteByAppointment(tx, appointmentId, {
        forUpdate: true,
      });
      if (!note) throw new NotFoundException('Nota no encontrada');

      const appointment = await this.appointments.findById(tx, appointmentId);
      if (!appointment) throw new NotFoundException('Cita no encontrada');

      const { userId } = this.ctx.get();
      if (note.doctorId !== userId) throw new NotaDeOtroMedicoError();

      const firma = await this.records.getDoctorSignature(tx, userId);
      const especialidad = await this.records.getDoctorEspecialidad(tx, note.doctorId);
      const now = new Date();

      // Valida firma y NOM-004 y cierra (inmutable). Lanza FirmaIncompletaError
      // o IncompleteClinicalNoteError si falta algo.
      note.close(
        contenido,
        { medicoNombre: firma?.nombre ?? '', cedula: firma?.cedula ?? null, fecha: now.toISOString() },
        now,
        especialidad,
      );
      if (!(await this.records.saveClosedNote(tx, note))) {
        throw new NoteAlreadyClosedError();
      }

      appointment.finish(now); // en_consulta → finalizada
      await this.appointments.save(tx, appointment);

      await this.audit.record(tx, {
        entidad: 'clinical_note',
        entidadId: note.id,
        accion: 'close_note',
        detalle: { appointmentId, plantillaVersion: plantillaDe(note.contenido) },
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
