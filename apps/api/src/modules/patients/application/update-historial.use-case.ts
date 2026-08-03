import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { HistorialPaciente, UpdateHistorialRequest } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { AuditService } from '../../../common/audit/audit.service';
import { PATIENT_REPOSITORY, type PatientRepository } from '../domain/patient.repository';

/**
 * Actualiza alergias y antecedentes del paciente.
 *
 * Queda auditado (LFPDPPP/NOM-004): son datos personales sensibles y de alto
 * impacto clínico — quién los cambió y cuándo importa tanto como el dato.
 */
@Injectable()
export class UpdateHistorialUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    @Inject(PATIENT_REPOSITORY) private readonly patients: PatientRepository,
  ) {}

  async execute(patientId: string, input: UpdateHistorialRequest): Promise<HistorialPaciente> {
    return this.tenantDb.run(async (tx) => {
      const historial = await this.patients.updateHistorial(tx, patientId, input);
      // RLS ya impide tocar pacientes de otra clínica; si no hubo fila, el id
      // simplemente no existe en este tenant.
      if (!historial) throw new NotFoundException('Paciente no encontrado');

      await this.audit.record(tx, {
        entidad: 'patient',
        entidadId: patientId,
        accion: 'update_historial',
        // Se registran los CONTEOS, no las sustancias: la bitácora no necesita
        // duplicar el dato sensible que ya vive en la tabla del paciente.
        detalle: {
          alergias: input.alergias.length,
          banderas: input.antecedentes.banderas.length,
          sinAlergiasConocidas: input.sinAlergiasConocidas,
        },
      });

      return historial;
    });
  }
}
