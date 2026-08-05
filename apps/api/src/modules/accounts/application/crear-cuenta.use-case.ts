import { Inject, Injectable } from '@nestjs/common';
import {
  cuposDisponibles,
  type CrearCuentaRequest,
  type CuentaView,
} from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { RequestContextService } from '../../../common/tenant-context/request-context';
import { AuditService } from '../../../common/audit/audit.service';
import { PlanService } from '../../../common/plan/plan.service';
import { LimitePlanAlcanzadoError } from '../../../common/plan/plan.errors';
import { PasswordHasherService } from '../../auth/application/password-hasher.service';
import {
  CUENTAS_REPOSITORY,
  type CuentasRepository,
} from '../domain/cuentas.repository';
import { EmailYaRegistradoError, MedicoTitularInvalidoError } from '../domain/cuenta.errors';

/**
 * Alta de una cuenta del equipo: otro médico del consultorio, o el asistente
 * que ayuda con la agenda.
 *
 * La cuenta nace en el MISMO tenant que el titular — comparte clínica,
 * pacientes y agenda — y con el rol que decide sus permisos vía CASL. Un
 * médico nuevo es una cuenta independiente (su expediente, su agenda, su
 * nota), ligada al titular por el tenant y por `creado_por`.
 *
 * El orden de las validaciones es intencionado: primero lo barato (¿cabe en el
 * plan? ¿el correo está libre?) y el hash bcrypt —~100 ms de CPU— hasta el
 * final, para no pagarlo en un alta que iba a fallar de todos modos.
 */
@Injectable()
export class CrearCuentaUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly ctx: RequestContextService,
    private readonly audit: AuditService,
    private readonly plan: PlanService,
    private readonly hasher: PasswordHasherService,
    @Inject(CUENTAS_REPOSITORY) private readonly repo: CuentasRepository,
  ) {}

  async execute(input: CrearCuentaRequest): Promise<CuentaView> {
    const email = input.email.trim().toLowerCase();
    const nombre = input.nombre.trim();
    const { userId } = this.ctx.get();

    return this.tenantDb.run(async (tx) => {
      const { plan, limites } = await this.plan.planYLimites(tx);
      const conteo = await this.repo.contarActivas(tx);
      const cupos = cuposDisponibles(limites, conteo.medicos, conteo.asistentes);

      if (input.rol === 'medico' && !cupos.puedeAgregarMedico) {
        throw new LimitePlanAlcanzadoError('medicos', limites.maxMedicos!, limites.nombre);
      }
      if (input.rol === 'asistente' && !cupos.puedeAgregarAsistente) {
        throw new LimitePlanAlcanzadoError('asistentes', limites.maxAsistentes!, limites.nombre);
      }

      if (await this.repo.existeEmail(tx, email)) {
        throw new EmailYaRegistradoError(email);
      }

      /**
       * A qué médico asiste. Por defecto, a quien lo dio de alta: el caso
       * normal es el consultorio de un solo doctor con su recepcionista, y
       * obligar a elegir ahí sería un paso de más para todos.
       */
      let medicoTitularId: string | null = null;
      if (input.rol === 'asistente') {
        medicoTitularId = input.medicoTitularId ?? userId;
        if (!(await this.repo.esMedicoActivo(tx, medicoTitularId))) {
          throw new MedicoTitularInvalidoError(medicoTitularId);
        }
      }

      const passwordHash = await this.hasher.hash(input.password);

      const cuenta = await this.repo.create(tx, {
        nombre,
        email,
        passwordHash,
        rol: input.rol,
        // Rol y capacidad clínica van por separado (ver users.es_medico): el
        // rol decide permisos, es_medico decide si aparece en la agenda.
        esMedico: input.rol === 'medico',
        cedulaProfesional: input.rol === 'medico' ? (input.cedulaProfesional?.trim() || null) : null,
        especialidad: input.rol === 'medico' ? (input.especialidad?.trim() || null) : null,
        especialidadKey: input.rol === 'medico' ? (input.especialidadKey ?? 'general') : 'general',
        creadoPor: userId,
        medicoTitularId,
      });

      // Nunca se audita la contraseña ni su hash: quién creó qué cuenta y con
      // qué permisos es lo que importa para LFPDPPP.
      await this.audit.record(tx, {
        entidad: 'user',
        entidadId: cuenta.id,
        accion: 'create',
        detalle: { nombre, email, rol: input.rol, plan },
      });

      return cuenta;
    });
  }
}
