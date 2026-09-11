import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  FEATURE_FLAGS,
  FEATURE_FLAG_LABELS,
  isFeatureFlag,
  modulosDePlan,
  type EstadoEntitlement,
  type FeatureFlag,
  type FuenteEntitlement,
  type ModuloView,
} from '@healthflow/shared-types';
import type { Tx } from '../../db/drizzle';
import { TenantDbService } from '../tenant-context/tenant-db.service';
import { RequestContextService } from '../tenant-context/request-context';
import { AuditService } from '../audit/audit.service';
import { debeRestringir } from '../subscription/debe-restringir';
import { esSubscriptionStatus } from '../subscription/subscription-status';
import {
  capacidadEfectiva,
  estaDisponible,
  permite,
  razonDe,
  tieneDerechoVigente,
  type Capacidad,
  type EntradaCapacidad,
  type ModoAcceso,
} from './capacidad';
import { ModuloDesconocidoError, ModuloNoDisponibleError } from './capacidad.errors';

interface FilaEstado {
  module_key: string;
  configuracion: boolean;
  rollout: boolean;
  configurado_at: Date | string | null;
  notas: string | null;
  entitlement_estado: string | null;
  entitlement_fuente: string | null;
  entitlement_hasta: Date | string | null;
}

/**
 * Resuelve la capacidad de la clínica activa sobre cada módulo.
 *
 * Junta en UNA lectura los cuatro ejes (contratado, suscripción, rollout,
 * configuración) y delega la decisión a `capacidadEfectiva`, que es pura. Este
 * servicio sólo sabe de dónde sale cada dato; la regla vive en un solo lugar.
 *
 * El entitlement tiene dos orígenes: el plan contratado (mapa versionado en
 * shared-types) y la tabla `tenant_module_entitlements` para add-ons, pruebas
 * y excepciones comerciales. La tabla GANA cuando existe: es donde se registra
 * una suspensión, y una suspensión tiene que poder apagar lo que el plan
 * incluye. Sin fila, el plan decide.
 *
 * Sin caché, por el mismo motivo que EstadoSuscripcionReader: apagar un módulo
 * durante un incidente tiene que valer en la siguiente petición.
 */
@Injectable()
export class CapacidadService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly audit: AuditService,
    private readonly ctx: RequestContextService,
  ) {}

  /**
   * Dentro de la transacción de un caso de uso o de un consumidor.
   *
   * Las dos lecturas van SECUENCIALES, no en `Promise.all`: comparten la misma
   * conexión de PostgreSQL (es una transacción, no un pool), y node-postgres
   * no multiplexa — dos consultas en vuelo sobre el mismo cliente se pisan.
   * Además serían dos viajes en paralelo para ahorrar microsegundos en algo
   * que ya son dos lecturas por índice.
   */
  async evaluar(tx: Tx, modulo: FeatureFlag, ahora = new Date()): Promise<Capacidad> {
    const clinica = await this.leerClinica(tx, ahora);
    const estados = await this.leerEstados(tx);
    return capacidadEfectiva(
      entrada(modulo, estados.get(modulo), clinica.plan, clinica.suscripcionVigente),
      ahora,
    );
  }

  /**
   * Igual que `evaluar`, pero corta el caso de uso si el modo pedido no está
   * permitido. `modo` es obligatorio a propósito: obliga a cada caso de uso a
   * declarar si lee o escribe, que es justo la distinción que hace que una
   * clínica con el pago atrasado siga pudiendo consultar su historial.
   */
  async asegurar(
    tx: Tx,
    modulo: FeatureFlag,
    modo: ModoAcceso,
    ahora = new Date(),
  ): Promise<void> {
    const capacidad = await this.evaluar(tx, modulo, ahora);
    if (!permite(capacidad, modo)) {
      throw new ModuloNoDisponibleError(modulo, razonDe(capacidad)!);
    }
  }

  /** Para quien no tiene transacción abierta (el interceptor de rutas). */
  async evaluarSuelto(modulo: FeatureFlag, ahora = new Date()): Promise<Capacidad> {
    return this.tenantDb.run((tx) => this.evaluar(tx, modulo, ahora));
  }

  /** El catálogo COMPLETO con sus cuatro ejes: es la pantalla de Ajustes. */
  async listar(ahora = new Date()): Promise<ModuloView[]> {
    return this.tenantDb.run(async (tx) => {
      const clinica = await this.leerClinica(tx, ahora);
      const estados = await this.leerEstados(tx);
      return FEATURE_FLAGS.map((modulo) => {
        const fila = estados.get(modulo);
        const datos = entrada(modulo, fila, clinica.plan, clinica.suscripcionVigente);
        const capacidad = capacidadEfectiva(datos, ahora);
        const hasta = fila?.entitlement_hasta ?? null;
        const configuradoAt = fila?.configurado_at ?? null;
        return {
          flag: modulo,
          nombre: FEATURE_FLAG_LABELS[modulo],
          // Mismo predicado que usa la decisión: un derecho suspendido o
          // vencido NO se muestra como contratado.
          contratado: tieneDerechoVigente(datos.entitlement, ahora),
          fuente: fuenteDe(fila, clinica.plan, modulo),
          vigenciaHasta: hasta ? new Date(hasta).toISOString() : null,
          rollout: datos.rollout,
          configuracion: datos.configuracion,
          disponible: estaDisponible(capacidad),
          razon: razonDe(capacidad),
          configuradoAt: configuradoAt ? new Date(configuradoAt).toISOString() : null,
          notas: fila?.notas ?? null,
        } satisfies ModuloView;
      });
    });
  }

  /**
   * El titular enciende o apaga el módulo para su clínica. Esto es el eje de
   * CONFIGURACIÓN y nada más: no concede el derecho (eso lo escribe HealthFlow
   * con `db:grant-module`) ni levanta un rollback.
   *
   * Se permite configurar un módulo que todavía no está contratado: la clínica
   * deja listo su "sí quiero", y el día que lo contrate empieza a funcionar sin
   * que nadie tenga que volver a esta pantalla.
   */
  async configurar(modulo: string, habilitado: boolean, notas?: string | null): Promise<ModuloView> {
    if (!isFeatureFlag(modulo)) throw new ModuloDesconocidoError(modulo);
    await this.tenantDb.run(async (tx) => {
      await tx.execute(sql`
        INSERT INTO tenant_feature_flags (flag, habilitado, habilitado_at, habilitado_por, notas)
        VALUES (${modulo}, ${habilitado}, ${habilitado ? sql`now()` : sql`NULL`},
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
      `);
      await this.audit.record(tx, {
        entidad: 'Modulo',
        accion: habilitado ? 'activar' : 'desactivar',
        detalle: { modulo },
      });
    });
    const vista = (await this.listar()).find((m) => m.flag === modulo);
    return vista!;
  }

  /**
   * Una sola consulta para los tres ejes que viven en la base.
   *
   * `DISTINCT ON` y no un filtro por estado: se necesita UNA fila por módulo,
   * y se prefiere la viva; si no hay, la más reciente. Filtrar por
   * `status IN ('active','trialing')` dentro del JOIN parecía más simple pero
   * estaba mal: con FULL OUTER JOIN, una fila suspendida no cumple la
   * condición y reaparece como fila suelta, duplicando el módulo y pisando su
   * configuración. Además una suspensión TIENE que verse — es justo lo que
   * debe poder apagar un módulo incluido en el plan.
   */
  private async leerEstados(tx: Tx): Promise<Map<string, FilaEstado>> {
    const filas = (
      await tx.execute(sql`
        WITH ent AS (
          SELECT DISTINCT ON (module_key) module_key, status, source, ends_at
            FROM tenant_module_entitlements
           ORDER BY module_key, (status IN ('active','trialing')) DESC, updated_at DESC
        )
        SELECT coalesce(f.flag, e.module_key) AS module_key,
               coalesce(f.habilitado, false)          AS configuracion,
               coalesce(f.rollout_habilitado, true)   AS rollout,
               f.habilitado_at                        AS configurado_at,
               f.notas                                AS notas,
               e.status                               AS entitlement_estado,
               e.source                               AS entitlement_fuente,
               e.ends_at                              AS entitlement_hasta
          FROM tenant_feature_flags f
          FULL OUTER JOIN ent e ON e.module_key = f.flag
      `)
    ).rows as unknown as FilaEstado[];
    return new Map(filas.map((f) => [f.module_key, f]));
  }

  /**
   * Plan y estado de cobro en UNA lectura: los dos salen de la misma fila de
   * `tenants`, y antes eran dos consultas que además viajaban en paralelo
   * sobre la misma transacción. Sin `WHERE`: RLS ya deja ver sólo la clínica
   * en curso (mismo patrón que PlanService y EstadoSuscripcionReader).
   */
  private async leerClinica(
    tx: Tx,
    ahora: Date,
  ): Promise<{ plan: string; suscripcionVigente: boolean }> {
    const row = (
      await tx.execute(sql`SELECT plan, subscription_status, grace_until FROM tenants LIMIT 1`)
    ).rows[0] as
      | { plan: string; subscription_status: string; grace_until: Date | string | null }
      | undefined;
    const status = row?.subscription_status ?? 'none';
    return {
      plan: row?.plan ?? 'individual',
      suscripcionVigente: !debeRestringir(
        {
          status: esSubscriptionStatus(status) ? status : 'none',
          graceUntil: row?.grace_until ? new Date(row.grace_until) : null,
        },
        ahora,
      ),
    };
  }
}

/**
 * Arma la entrada de la función pura a partir de lo leído.
 *
 * Cómo se combinan plan y tabla, que es la parte con criterio:
 *
 *  - sin fila → manda el plan;
 *  - fila viva (`active`/`trialing`) → manda la fila (es un add-on o una prueba);
 *  - fila `suspended` → manda la fila AUNQUE el plan lo incluya. Suspender es
 *    una decisión comercial explícita y tiene que poder apagar lo contratado;
 *  - fila `expired` → vuelve a mandar el plan. Que se acabe una prueba no le
 *    quita a la clínica un módulo que su plan ya incluye — ese fue el bug que
 *    tendría "la tabla siempre gana".
 */
function entrada(
  modulo: FeatureFlag,
  fila: FilaEstado | undefined,
  plan: string,
  suscripcionVigente: boolean,
): EntradaCapacidad {
  return {
    suscripcionVigente,
    entitlement: entitlementDe(fila, plan, modulo),
    rollout: fila?.rollout ?? true,
    configuracion: fila?.configuracion ?? false,
  };
}

function entitlementDe(
  fila: FilaEstado | undefined,
  plan: string,
  modulo: FeatureFlag,
): EntradaCapacidad['entitlement'] {
  const porPlan = modulosDePlan(plan).includes(modulo)
    ? { estado: 'active' as EstadoEntitlement, vigenciaHasta: null }
    : null;
  const estado = fila?.entitlement_estado as EstadoEntitlement | null | undefined;
  if (!estado) return porPlan;
  const porTabla = {
    estado,
    vigenciaHasta: fila?.entitlement_hasta ? new Date(fila.entitlement_hasta) : null,
  };
  if (estado === 'expired') return porPlan ?? porTabla;
  return porTabla;
}

function fuenteDe(
  fila: FilaEstado | undefined,
  plan: string,
  modulo: FeatureFlag,
): FuenteEntitlement | null {
  const estado = fila?.entitlement_estado;
  if (estado === 'suspended') return null; // suspendido: no hay derecho que mostrar
  const vivo = estado === 'active' || estado === 'trialing';
  if (vivo && fila?.entitlement_fuente) return fila.entitlement_fuente as FuenteEntitlement;
  return modulosDePlan(plan).includes(modulo) ? 'plan' : null;
}
