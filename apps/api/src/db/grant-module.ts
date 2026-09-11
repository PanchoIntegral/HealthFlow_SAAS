/**
 * Concede, suspende o libera módulos para una clínica. Corre como rol ADMIN.
 *
 * Es la ÚNICA vía de escritura sobre `tenant_module_entitlements` y sobre el
 * interruptor de rollout: el rol de la aplicación sólo tiene SELECT sobre la
 * tabla y el UPDATE revocado sobre `rollout_habilitado`. No existe endpoint
 * HTTP a propósito (ADR 0004, D2) — la forma más barata de garantizar que el
 * administrador de una clínica no se conceda un módulo que no compró es que no
 * haya ninguna ruta que lo conceda.
 *
 * Uso:
 *   pnpm db:grant-module --tenant <uuid> --module dental_recalls --source addon
 *   pnpm db:grant-module --tenant <uuid> --module dental_recalls --status suspended
 *   pnpm db:grant-module --tenant <uuid> --module dental_recalls --trial 30
 *   pnpm db:grant-module --tenant <uuid> --module dental_recalls --rollout off --nota "incidente #42"
 *   pnpm db:grant-module --tenant <uuid> --list
 */
import { Client } from 'pg';
import {
  ESTADOS_ENTITLEMENT,
  FUENTES_ENTITLEMENT,
  isFeatureFlag,
  type EstadoEntitlement,
  type FuenteEntitlement,
} from '@healthflow/shared-types';
import { loadDotEnv, env } from '../config/env';

loadDotEnv();

interface Opciones {
  tenant?: string;
  module?: string;
  source: FuenteEntitlement;
  status: EstadoEntitlement;
  trial?: number;
  rollout?: 'on' | 'off';
  nota?: string;
  list: boolean;
}

function parsear(argv: string[]): Opciones {
  const opciones: Opciones = { source: 'manual', status: 'active', list: false };
  for (let i = 0; i < argv.length; i++) {
    const valor = argv[i + 1];
    switch (argv[i]) {
      case '--tenant': opciones.tenant = valor; i++; break;
      case '--module': opciones.module = valor; i++; break;
      case '--source': opciones.source = valor as FuenteEntitlement; i++; break;
      case '--status': opciones.status = valor as EstadoEntitlement; i++; break;
      case '--trial': opciones.trial = Number(valor); i++; break;
      case '--rollout': opciones.rollout = valor === 'off' ? 'off' : 'on'; i++; break;
      case '--nota': opciones.nota = valor; i++; break;
      case '--list': opciones.list = true; break;
    }
  }
  return opciones;
}

async function main(): Promise<void> {
  const o = parsear(process.argv.slice(2));
  if (!o.tenant) throw new Error('Falta --tenant <uuid>');

  const client = new Client({ connectionString: env.adminDatabaseUrl });
  await client.connect();
  try {
    const clinica = await client.query('SELECT nombre_clinica, plan FROM tenants WHERE id=$1', [o.tenant]);
    if (clinica.rowCount === 0) throw new Error(`No existe la clínica ${o.tenant}`);
    console.log(`Clínica: ${clinica.rows[0].nombre_clinica} (plan ${clinica.rows[0].plan})`);

    if (o.list) return void (await listar(client, o.tenant));

    if (!o.module) throw new Error('Falta --module <clave>');
    if (!isFeatureFlag(o.module)) throw new Error(`'${o.module}' no está en el catálogo de módulos`);

    if (o.rollout) {
      await client.query(
        `INSERT INTO tenant_feature_flags (tenant_id, flag, rollout_habilitado, rollout_nota, rollout_cambiado_at)
         VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (tenant_id, flag) DO UPDATE SET
           rollout_habilitado=EXCLUDED.rollout_habilitado,
           rollout_nota=EXCLUDED.rollout_nota,
           rollout_cambiado_at=now(), updated_at=now()`,
        [o.tenant, o.module, o.rollout === 'on', o.nota ?? null],
      );
      console.log(`✓ rollout de ${o.module}: ${o.rollout}`);
      return void (await listar(client, o.tenant));
    }

    if (!FUENTES_ENTITLEMENT.includes(o.source)) throw new Error(`--source inválido: ${o.source}`);
    if (!ESTADOS_ENTITLEMENT.includes(o.status)) throw new Error(`--status inválido: ${o.status}`);

    const status: EstadoEntitlement = o.trial ? 'trialing' : o.status;
    const source: FuenteEntitlement = o.trial ? 'trial' : o.source;
    const endsAt = o.trial ? `now() + interval '${Math.max(1, Math.trunc(o.trial))} days'` : 'NULL';

    // Un solo derecho vivo por módulo (índice único parcial). Al conceder uno
    // nuevo, el anterior se marca vencido en vez de borrarse: el historial de
    // qué tuvo contratado la clínica es justamente lo que no debe perderse.
    await client.query('BEGIN');
    await client.query(
      `UPDATE tenant_module_entitlements SET status='expired', updated_at=now()
        WHERE tenant_id=$1 AND module_key=$2 AND status IN ('active','trialing')`,
      [o.tenant, o.module],
    );
    await client.query(
      `INSERT INTO tenant_module_entitlements
         (tenant_id, module_key, source, status, ends_at, metadata)
       VALUES ($1,$2,$3,$4,${endsAt},$5::jsonb)`,
      [o.tenant, o.module, source, status, JSON.stringify(o.nota ? { nota: o.nota } : {})],
    );
    await client.query('COMMIT');
    console.log(`✓ ${o.module}: ${status} (${source})`);
    await listar(client, o.tenant);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function listar(client: Client, tenant: string): Promise<void> {
  const filas = await client.query(
    `SELECT e.module_key, e.source, e.status, e.ends_at,
            coalesce(f.rollout_habilitado, true) AS rollout,
            coalesce(f.habilitado, false) AS configurado
       FROM tenant_module_entitlements e
       LEFT JOIN tenant_feature_flags f ON f.tenant_id=e.tenant_id AND f.flag=e.module_key
      WHERE e.tenant_id=$1 ORDER BY e.module_key, e.created_at DESC`,
    [tenant],
  );
  if (filas.rowCount === 0) return console.log('(sin derechos explícitos; aplica el mapa del plan)');
  console.table(filas.rows);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
