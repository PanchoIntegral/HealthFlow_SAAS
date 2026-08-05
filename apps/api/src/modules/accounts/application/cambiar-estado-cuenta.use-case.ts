import { Inject, Injectable } from '@nestjs/common';
import { cuposDisponibles, type CuentaView } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { AuditService } from '../../../common/audit/audit.service';
import { PlanService } from '../../../common/plan/plan.service';
import { LimitePlanAlcanzadoError } from '../../../common/plan/plan.errors';
import { CUENTAS_REPOSITORY, type CuentasRepository } from '../domain/cuentas.repository';
import {
  CuentaNoEncontradaError,
  NoSePuedeDesactivarAlTitularError,
} from '../domain/cuenta.errors';

/**
 * Da de baja o vuelve a habilitar una cuenta. Baja LÓGICA, nunca borrado: las
 * notas firmadas, las citas y las facturas de esa persona deben seguir
 * apuntando a un usuario real para siempre (NOM-004). Desactivar corta el
 * login y libera el asiento del plan; el historial se queda.
 */
@Injectable()
export class CambiarEstadoCuentaUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    private readonly plan: PlanService,
    @Inject(CUENTAS_REPOSITORY) private readonly repo: CuentasRepository,
  ) {}

  async execute(cuentaId: string, activo: boolean): Promise<CuentaView> {
    return this.tenantDb.run(async (tx) => {
      const cuenta = await this.repo.getById(tx, cuentaId);
      if (!cuenta) throw new CuentaNoEncontradaError(cuentaId);
      if (cuenta.activo === activo) return cuenta;

      if (!activo && cuenta.esTitular) throw new NoSePuedeDesactivarAlTitularError();

      // Reactivar vuelve a ocupar asiento, así que se cobra el mismo cupo que
      // un alta nueva. Sin esto, desactivar y reactivar sería la forma trivial
      // de rebasar el plan.
      if (activo) {
        const { limites } = await this.plan.planYLimites(tx);
        const conteo = await this.repo.contarActivas(tx);
        const cupos = cuposDisponibles(limites, conteo.medicos, conteo.asistentes);

        if (cuenta.esMedico || cuenta.rol === 'medico') {
          if (!cupos.puedeAgregarMedico) {
            throw new LimitePlanAlcanzadoError('medicos', limites.maxMedicos!, limites.nombre);
          }
        } else if (cuenta.rol === 'asistente' && !cupos.puedeAgregarAsistente) {
          throw new LimitePlanAlcanzadoError('asistentes', limites.maxAsistentes!, limites.nombre);
        }
      }

      const actualizada = await this.repo.setActivo(tx, cuentaId, activo);
      if (!actualizada) throw new CuentaNoEncontradaError(cuentaId);

      await this.audit.record(tx, {
        entidad: 'user',
        entidadId: cuentaId,
        accion: activo ? 'reactivar' : 'desactivar',
        detalle: { email: cuenta.email, rol: cuenta.rol },
      });

      return actualizada;
    });
  }
}
