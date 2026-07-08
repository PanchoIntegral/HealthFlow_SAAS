import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ClinicalNoteView } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import {
  CLINICAL_RECORD_REPOSITORY,
  type ClinicalRecordRepository,
} from '../domain/clinical-record.repository';

/** Devuelve la nota (borrador o cerrada) ligada a una cita, para hidratar el editor. */
@Injectable()
export class GetConsultationNoteUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(CLINICAL_RECORD_REPOSITORY) private readonly records: ClinicalRecordRepository,
  ) {}

  async execute(appointmentId: string): Promise<ClinicalNoteView> {
    const note = await this.tenantDb.run((tx) =>
      this.records.findNoteByAppointment(tx, appointmentId),
    );
    if (!note) throw new NotFoundException('Nota no encontrada');
    const s = note.toState();
    return {
      id: s.id,
      appointmentId: s.appointmentId,
      doctorId: s.doctorId,
      tipoNota: s.tipoNota,
      estatus: s.estatus,
      contenido: s.contenido,
      cerradoEn: s.cerradoEn ? s.cerradoEn.toISOString() : null,
      createdAt: new Date().toISOString(),
    };
  }
}
