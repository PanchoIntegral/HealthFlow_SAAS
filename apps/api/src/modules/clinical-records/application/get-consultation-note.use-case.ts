import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ConsultationNoteView } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import {
  CLINICAL_RECORD_REPOSITORY,
  type ClinicalRecordRepository,
} from '../domain/clinical-record.repository';
import { evaluarEsquema, validarCierre } from '../domain/motor-reglas';

/**
 * Devuelve la nota (borrador o cerrada) ligada a una cita, para hidratar el
 * editor, junto con lo que la API decide sobre ella: qué campos pide y qué
 * falta para firmar. El editor pinta con eso; no reimplementa reglas.
 */
@Injectable()
export class GetConsultationNoteUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(CLINICAL_RECORD_REPOSITORY) private readonly records: ClinicalRecordRepository,
  ) {}

  async execute(appointmentId: string): Promise<ConsultationNoteView> {
    return this.tenantDb.run(async (tx) => {
      const note = await this.records.findNoteByAppointment(tx, appointmentId);
      if (!note) throw new NotFoundException('Nota no encontrada');
      const s = note.toState();

      // Una nota en borrador todavía no está firmada: debe reflejar la
      // especialidad ACTUAL del médico, no la que tenía cuando se abrió la
      // consulta. Cerrada, se congela para siempre (NOM-004) — ver
      // CreateDraftNoteInput.especialidad en clinical-record.repository.ts.
      //
      // Excepción: una nota con plantilla versionada conserva la especialidad
      // estampada, porque su contexto (primera valoración o seguimiento) se
      // calculó para esa especialidad.
      const especialidad =
        s.estatus === 'borrador' && !s.contenido.plantillaVersion
          ? await this.records.getDoctorEspecialidad(tx, s.doctorId)
          : s.contenido.especialidad;
      const contenido = { ...s.contenido, especialidad };

      const cerrada = s.estatus === 'cerrada';
      // Cerrada: se lee con el esquema con que se firmó. Una nota firmada
      // antes de existir la instantánea se evalúa como legacy, sin pendientes.
      const esquema = (cerrada && s.contenido.esquemaAlCierre) || evaluarEsquema(contenido);
      const pideVerificacion = esquema.campos.some((c) => c.ruta === 'verificacionAntecedentes');

      return {
        id: s.id,
        appointmentId: s.appointmentId,
        doctorId: s.doctorId,
        tipoNota: s.tipoNota,
        estatus: s.estatus,
        contenido,
        cerradoEn: s.cerradoEn ? s.cerradoEn.toISOString() : null,
        createdAt: s.createdAt.toISOString(),
        // Un borrador no puede tener correcciones (todavía no se firma), así
        // que no se consulta la tabla en el caso más frecuente.
        correcciones: cerrada ? await this.records.getCorrecciones(tx, s.id) : [],
        esquema,
        pendientes: cerrada ? [] : validarCierre(contenido, esquema),
        // Sólo en borrador: en una nota firmada, "lo vigente hoy" no es lo que
        // el profesional tuvo a la vista al firmar, y mostrarlo confundiría.
        referenciaAntecedentes: pideVerificacion && !cerrada
          ? await this.records.getReferenciaAntecedentes(tx, s.clinicalRecordId)
          : null,
      };
    });
  }
}
