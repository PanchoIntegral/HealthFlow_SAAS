import { Inject, Injectable } from '@nestjs/common';
import type { CreatePatientRequest, PatientSummary } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { AuditService } from '../../../common/audit/audit.service';
import { PlanService } from '../../../common/plan/plan.service';
import { LimitePlanAlcanzadoError } from '../../../common/plan/plan.errors';
import { Patient } from '../domain/patient.entity';
import { DuplicateCurpError } from '../domain/patient.errors';
import {
  PATIENT_REPOSITORY,
  type PatientRepository,
} from '../domain/patient.repository';

/** Caso de uso: alta de un paciente nuevo en la clínica activa. */
@Injectable()
export class RegisterPatientUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    private readonly plan: PlanService,
    @Inject(PATIENT_REPOSITORY) private readonly repo: PatientRepository,
  ) {}

  async execute(input: CreatePatientRequest): Promise<PatientSummary> {
    const patient = Patient.register(input); // valida CURP / fecha (dominio)

    return this.tenantDb.run(async (tx) => {
      const props = patient.toProps();

      /**
       * Cupo de pacientes del plan (300 en Individual, sin tope arriba). Se
       * comprueba DENTRO de la transacción y contra la base, no contra un
       * contador guardado: un contador desfasado deja pasar altas de más y no
       * hay forma de saber cuál sobró.
       */
      const limites = await this.plan.limites(tx);
      if (limites.maxPacientes !== null) {
        const total = await this.repo.contarTodos(tx);
        if (total >= limites.maxPacientes) {
          throw new LimitePlanAlcanzadoError('pacientes', limites.maxPacientes, limites.nombre);
        }
      }

      if (props.curp && (await this.repo.existsByCurp(tx, props.curp))) {
        throw new DuplicateCurpError(props.curp);
      }

      const id = await this.repo.create(tx, patient);

      await this.audit.record(tx, {
        entidad: 'patient',
        entidadId: id,
        accion: 'create',
        detalle: { nombre: props.nombre, curp: props.curp },
      });

      return {
        id,
        nombre: props.nombre,
        edad: Patient.edad(props.fechaNacimiento),
        curp: props.curp,
        telefono: props.telefono,
      };
    });
  }
}
