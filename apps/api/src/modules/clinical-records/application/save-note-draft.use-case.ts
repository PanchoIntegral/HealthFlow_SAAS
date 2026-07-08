import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { NotaEvolucionContent } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import {
  CLINICAL_RECORD_REPOSITORY,
  type ClinicalRecordRepository,
} from '../domain/clinical-record.repository';

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
      note.saveDraft(contenido); // lanza NoteAlreadyClosedError si ya está cerrada
      await this.records.saveNote(tx, note);
    });
  }
}
