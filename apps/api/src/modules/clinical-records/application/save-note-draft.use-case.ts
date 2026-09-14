import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  plantillaDe,
  type GuardarBorradorResponse,
  type NotaEvolucionContent,
} from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { AuditService } from '../../../common/audit/audit.service';
import { env } from '../../../config/env';
import { debeAuditarAutosave, huellaContenido } from '../domain/auditoria-nota';
import {
  CLINICAL_RECORD_REPOSITORY,
  type ClinicalRecordRepository,
} from '../domain/clinical-record.repository';
import { NoteAlreadyClosedError } from '../domain/clinical-note.errors';
import { evaluarEsquema, validarCierre } from '../domain/motor-reglas';

/** Autosave del borrador de la nota (mientras la consulta está en curso). */
@Injectable()
export class SaveNoteDraftUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    @Inject(CLINICAL_RECORD_REPOSITORY) private readonly records: ClinicalRecordRepository,
  ) {}

  /**
   * Devuelve el esquema recalculado: lo que la nota pide puede cambiar con lo
   * recién capturado (un diagnóstico, el motivo), y así el editor lo refleja
   * sin evaluar reglas por su cuenta.
   */
  execute(appointmentId: string, contenido: NotaEvolucionContent): Promise<GuardarBorradorResponse> {
    return this.tenantDb.run(async (tx) => {
      const note = await this.records.findNoteByAppointment(tx, appointmentId);
      if (!note) throw new NotFoundException('Nota no encontrada');
      // La especialidad de un borrador es la ACTUAL del médico (igual que al
      // leerlo en GetConsultationNoteUseCase), nunca la que diga el cliente.
      const especialidad = await this.records.getDoctorEspecialidad(tx, note.doctorId);
      note.saveDraft(contenido, especialidad); // lanza NoteAlreadyClosedError si ya está cerrada
      // La comprobación en memoria no basta: la nota pudo cerrarse después de
      // leerla. El UPDATE condicionado es la barrera real.
      if (!(await this.records.saveDraftContent(tx, note))) {
        throw new NoteAlreadyClosedError();
      }
      // Auditoría sin ruido y sin contenido: sólo si cambió la huella y pasó
      // la ventana (ver debeAuditarAutosave). La huella se calcula sobre lo
      // que de verdad se guardó, ya saneado y sellado.
      const huella = huellaContenido(note.contenido, env.auditoriaHuellaSecret);
      const ultima = await this.records.ultimaAuditoriaAutosave(tx, note.id);
      if (debeAuditarAutosave(ultima, huella, new Date())) {
        await this.audit.record(tx, {
          entidad: 'clinical_note',
          entidadId: note.id,
          accion: 'save_draft',
          detalle: { appointmentId, plantillaVersion: plantillaDe(note.contenido), huella },
        });
      }

      const esquema = evaluarEsquema(note.contenido);
      return { ok: true as const, esquema, pendientes: validarCierre(note.contenido, esquema) };
    });
  }
}
