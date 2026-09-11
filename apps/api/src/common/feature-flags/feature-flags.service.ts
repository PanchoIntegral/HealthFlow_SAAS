import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  FEATURE_FLAGS,
  FEATURE_FLAG_LABELS,
  isFeatureFlag,
  type FeatureFlag,
  type FeatureFlagView,
} from '@healthflow/shared-types';
import type { Tx } from '../../db/drizzle';
import { TenantDbService } from '../tenant-context/tenant-db.service';
import { RequestContextService } from '../tenant-context/request-context';
import { AuditService } from '../audit/audit.service';
import { FlagDesconocidoError, ModuloNoDisponibleError } from './feature-flags.errors';

interface FlagRow {
  flag: string;
  habilitado: boolean;
  habilitado_at: Date | string | null;
  notas: string | null;
}

/**
 * Qué módulos tiene liberados la clínica activa (§5.8).
 *
 * La AUSENCIA de fila significa apagado. Es lo que hace que un despliegue no
 * encienda nada por sorpresa y que el rollback sea un DELETE: los datos del
 * módulo siguen ahí, solo deja de estar accesible.
 *
 * Sin caché a propósito. Es una lectura por llave primaria y, cuando toca
 * apagar un módulo en producción por un incidente, el apagado tiene que valer
 * en la siguiente petición — no en 30 segundos.
 */
@Injectable()
export class FeatureFlagsService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    private readonly ctx: RequestContextService,
  ) {}

  /** Dentro de la transacción de un caso de uso. */
  async estaHabilitado(tx: Tx, flag: FeatureFlag): Promise<boolean> {
    const rows = (
      await tx.execute(
        sql`SELECT habilitado FROM tenant_feature_flags WHERE flag=${flag} LIMIT 1`,
      )
    ).rows as unknown as { habilitado: boolean }[];
    return rows[0]?.habilitado === true;
  }

  /** Igual que `estaHabilitado`, pero corta el caso de uso si está apagado. */
  async asegurarHabilitado(tx: Tx, flag: FeatureFlag): Promise<void> {
    if (!(await this.estaHabilitado(tx, flag))) throw new ModuloNoDisponibleError(flag);
  }

  /** Para quien no tiene transacción abierta (el interceptor de rutas). */
  async leer(flag: FeatureFlag): Promise<boolean> {
    return this.tenantDb.run((tx) => this.estaHabilitado(tx, flag));
  }

  /** El catálogo COMPLETO, con los apagados incluidos: es la pantalla de ajustes. */
  async listar(): Promise<FeatureFlagView[]> {
    return this.tenantDb.run(async (tx) => {
      const rows = (
        await tx.execute(sql`SELECT flag, habilitado, habilitado_at, notas FROM tenant_feature_flags`)
      ).rows as unknown as FlagRow[];
      const porFlag = new Map(rows.map((r) => [r.flag, r]));
      return FEATURE_FLAGS.map((flag) => vista(flag, porFlag.get(flag)));
    });
  }

  async establecer(flag: string, habilitado: boolean, notas?: string | null): Promise<FeatureFlagView> {
    if (!isFeatureFlag(flag)) throw new FlagDesconocidoError(flag);
    return this.tenantDb.run(async (tx) => {
      const row = (
        await tx.execute(sql`
          INSERT INTO tenant_feature_flags (flag, habilitado, habilitado_at, habilitado_por, notas)
          VALUES (${flag}, ${habilitado}, ${habilitado ? sql`now()` : sql`NULL`},
                  ${this.ctx.get().userId}, ${notas ?? null})
          ON CONFLICT (tenant_id, flag) DO UPDATE SET
            habilitado = EXCLUDED.habilitado,
            -- Conserva la fecha del primer encendido mientras siga encendido:
            -- sirve para saber desde cuándo la clínica usa el módulo.
            habilitado_at = CASE WHEN EXCLUDED.habilitado
                                 THEN coalesce(tenant_feature_flags.habilitado_at, now())
                                 ELSE NULL END,
            habilitado_por = EXCLUDED.habilitado_por,
            notas = EXCLUDED.notas,
            updated_at = now()
          RETURNING flag, habilitado, habilitado_at, notas
        `)
      ).rows[0] as unknown as FlagRow;
      await this.audit.record(tx, {
        entidad: 'FeatureFlag',
        accion: habilitado ? 'activar' : 'desactivar',
        detalle: { flag },
      });
      return vista(flag, row);
    });
  }
}

function vista(flag: FeatureFlag, row: FlagRow | undefined): FeatureFlagView {
  const at = row?.habilitado_at ?? null;
  return {
    flag,
    nombre: FEATURE_FLAG_LABELS[flag],
    habilitado: row?.habilitado === true,
    habilitadoAt: at ? new Date(at).toISOString() : null,
    notas: row?.notas ?? null,
  };
}
