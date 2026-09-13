import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { NotaEvolucionContent } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import {
  CLINICAL_RECORD_REPOSITORY,
  type ClinicalRecordRepository,
} from '../domain/clinical-record.repository';
import { NoteAlreadyClosedError } from '../domain/clinical-note.errors';

/** Autosave del borrador de la nota (mientras la consulta está en curso). */
@Injectable()
export class SaveNoteDraftUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(CLINICAL_RECORD_REPOSITORY) private readonly records: ClinicalRecordRepository,
  ) {}

  execute(appointmentId: string, contenido: NotaEvolucionContent): Promise<void> {
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
    });
  }
}
