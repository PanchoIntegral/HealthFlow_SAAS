import { Inject, Injectable } from '@nestjs/common';
import type { CuentasResumen } from '@healthflow/shared-types';
import { TenantDbService } from '../../../common/tenant-context/tenant-db.service';
import { PlanService } from '../../../common/plan/plan.service';
import { CUENTAS_REPOSITORY, type CuentasRepository } from '../domain/cuentas.repository';

/**
 * Las cuentas del consultorio junto con los cupos del plan. Van en la MISMA
 * respuesta a propósito: la pantalla necesita ambos para decidir si el botón
 * de "agregar" está disponible, y pedirlos por separado abriría una ventana
 * en la que la lista y el contador se contradicen.
 */
@Injectable()
export class ListarCuentasUseCase {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly plan: PlanService,
    @Inject(CUENTAS_REPOSITORY) private readonly repo: CuentasRepository,
  ) {}

  execute(): Promise<CuentasResumen> {
    return this.tenantDb.run(async (tx) => {
      const [{ plan, limites }, cuentas, conteo] = await Promise.all([
        this.plan.planYLimites(tx),
        this.repo.list(tx),
        this.repo.contarActivas(tx),
      ]);

      return {
        plan,
        limites,
        medicosActivos: conteo.medicos,
        asistentesActivos: conteo.asistentes,
        cuentas,
      };
    });
  }
}
