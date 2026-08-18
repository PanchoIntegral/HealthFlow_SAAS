import { Inject, Injectable } from '@nestjs/common';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { AuditService } from '../../../common/audit/audit.service';
import {
  PacienteConHistorialClinicoError,
  PacienteNoEncontradoError,
} from '../domain/patient.errors';
import { PATIENT_REPOSITORY, type PatientRepository } from '../domain/patient.repository';

/**
 * Borrado REAL de un paciente, permitido solo cuando nunca hubo acto médico.
 *
 * La distinción que aplica este caso de uso no es "se usa / no se usa", sino
 * si existe o no un expediente clínico:
 *
 *  - Sin actividad: el registro nació de un dedazo o es un duplicado. Nunca
 *    fue un expediente, así que borrarlo no destruye información médica.
 *  - Con actividad: la NOM-004 obliga a conservarlo cinco años desde el último
 *    acto médico, y los T&C (cláusula 10.4) trasladan esa obligación al
 *    cliente. Se rechaza y se ofrece archivar.
 *
 * La comprobación vive AQUÍ y no en la base a propósito: `patients` sí concede
 * DELETE al rol de la app, y nueve tablas cuelgan con ON DELETE CASCADE —
 * incluidas `consentimientos` y `recetas`, que se hicieron insert-only con
 * REVOKE UPDATE, DELETE. El CASCADE actúa a nivel de llave foránea y se salta
 * ese REVOKE sin avisar, así que la única barrera efectiva es esta regla.
 */
@Injectable()
export class EliminarPacienteUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    @Inject(PATIENT_REPOSITORY) private readonly repo: PatientRepository,
  ) {}

  async execute(patientId: string): Promise<void> {
    return this.tenantDb.run(async (tx) => {
      if (!(await this.repo.existe(tx, patientId))) throw new PacienteNoEncontradoError();

      const actividad = await this.repo.contarActividadClinica(tx, patientId);
      const total = Object.values(actividad).reduce((a, b) => a + b, 0);
      if (total > 0) {
        throw new PacienteConHistorialClinicoError(actividad);
      }

      const nombre = await this.repo.nombreActual(tx, patientId);

      // La bitácora se escribe ANTES del DELETE: `audit_log.entidad_id` no
      // tiene llave foránea a patients, así que la fila sobrevive al borrado y
      // queda constancia de qué se eliminó y quién lo hizo. Al revés no
      // funcionaría — dentro de la misma transacción da igual el orden, pero
      // escribirlo primero deja claro que la constancia es el objetivo.
      await this.audit.record(tx, {
        entidad: 'patient',
        entidadId: patientId,
        accion: 'eliminar',
        detalle: { nombre, sinActividadClinica: true },
      });

      await this.repo.eliminar(tx, patientId);
    });
  }
}
