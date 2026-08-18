import { Inject, Injectable } from '@nestjs/common';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { AuditService } from '../../../common/audit/audit.service';
import { PacienteNoEncontradoError } from '../domain/patient.errors';
import { PATIENT_REPOSITORY, type PatientRepository } from '../domain/patient.repository';

/**
 * Baja lógica del paciente: desaparece de búsquedas y listados, el expediente
 * se conserva íntegro.
 *
 * Es la respuesta correcta a "este paciente ya no se atiende". La NOM-004
 * obliga a conservar el expediente cinco años desde el último acto médico, así
 * que no hay nada que borrar — lo que sobra es el ruido en el buscador, y eso
 * es justo lo que quita el archivado.
 *
 * Reversible a propósito: archivar por error no debe costar un ticket de
 * soporte. Un paciente archivado que vuelve a la consulta se reactiva.
 */
@Injectable()
export class ArchivarPacienteUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    private readonly audit: AuditService,
    @Inject(PATIENT_REPOSITORY) private readonly repo: PatientRepository,
  ) {}

  async execute(patientId: string, archivar: boolean): Promise<void> {
    const userId = this.ctx.get().userId;

    return this.tenantDb.run(async (tx) => {
      const ok = await this.repo.archivar(tx, patientId, archivar ? userId : null);
      if (!ok) throw new PacienteNoEncontradoError();

      await this.audit.record(tx, {
        entidad: 'patient',
        entidadId: patientId,
        accion: archivar ? 'archivar' : 'reactivar',
      });
    });
  }
}
