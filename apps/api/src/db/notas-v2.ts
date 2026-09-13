/**
 * Enciende o apaga las notas clínicas v2 para una clínica y especialidad.
 * Corre como rol ADMIN.
 *
 * Es la ÚNICA vía de escritura sobre `notas_v2_rollout` (0053): el rol de la
 * aplicación sólo tiene SELECT y no existe endpoint HTTP. Activar v1 cambia
 * qué se le exige al médico para firmar, y eso requiere que la matriz de
 * campos esté aprobada por los responsables clínico y legal — no es algo que
 * el titular de una clínica deba poder encender desde Ajustes.
 *
 * Encender exige además que el catálogo v1 de la especialidad esté APROBADO
 * en el código (ver CATALOGO_NOTAS_V1 y motivoParaNoActivar). No hay forma de
 * forzarlo desde aquí: mientras sea borrador, el script se niega.
 *
 * Apagar sólo afecta a las consultas NUEVAS: una nota creada con v1 conserva
 * la plantilla que quedó estampada.
 *
 * Uso:
 *   pnpm db:notas-v2 --tenant <uuid> --especialidad cardiologia --on --nota "piloto aprobado acta 12"
 *   pnpm db:notas-v2 --tenant <uuid> --especialidad cardiologia --off --nota "incidente #42"
 *   pnpm db:notas-v2 --tenant <uuid> --list
 */
import { Client } from 'pg';
import { CATALOGO_NOTAS_V1, esEspecialidadValida } from '@healthflow/shared-types';
import { motivoParaNoActivar } from '../modules/clinical-records/domain/activacion-notas-v2';
import { loadDotEnv, env } from '../config/env';

loadDotEnv();

interface Opciones {
  tenant?: string;
  especialidad?: string;
  habilitar?: boolean;
  nota?: string;
  list: boolean;
}

function parsear(argv: string[]): Opciones {
  const o: Opciones = { list: false };
  for (let i = 0; i < argv.length; i++) {
    const valor = argv[i + 1];
    switch (argv[i]) {
      case '--tenant': o.tenant = valor; i++; break;
      case '--especialidad': o.especialidad = valor; i++; break;
      case '--nota': o.nota = valor; i++; break;
      case '--on': o.habilitar = true; break;
      case '--off': o.habilitar = false; break;
      case '--list': o.list = true; break;
    }
  }
  return o;
}

async function main(): Promise<void> {
  const o = parsear(process.argv.slice(2));
  if (!o.tenant) throw new Error('Falta --tenant <uuid>');

  const client = new Client({ connectionString: env.adminDatabaseUrl });
  await client.connect();
  try {
    const clinica = await client.query('SELECT nombre_clinica FROM tenants WHERE id=$1', [o.tenant]);
    if (clinica.rowCount === 0) throw new Error(`No existe la clínica ${o.tenant}`);
    console.log(`Clínica: ${clinica.rows[0].nombre_clinica}`);

    if (o.list) return void (await listar(client, o.tenant));

    if (!o.especialidad || !esEspecialidadValida(o.especialidad)) {
      throw new Error(`--especialidad inválida: ${o.especialidad ?? '(falta)'}`);
    }
    if (o.habilitar === undefined) throw new Error('Indica --on o --off');
    if (o.habilitar) {
      const rechazo = motivoParaNoActivar(o.especialidad);
      if (rechazo) throw new Error(`No se puede encender notas_v2: ${rechazo}`);
    }
    // Encender sin dejar constancia de la aprobación es justo lo que no debe pasar.
    if (o.habilitar && !o.nota?.trim()) {
      throw new Error('Encender requiere --nota con la referencia de la aprobación clínico-legal');
    }

    await client.query('BEGIN');
    await client.query(
      `INSERT INTO notas_v2_rollout (tenant_id, especialidad, habilitado, nota, cambiado_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (tenant_id, especialidad) DO UPDATE SET
         habilitado=EXCLUDED.habilitado, nota=EXCLUDED.nota, cambiado_at=now()`,
      [o.tenant, o.especialidad, o.habilitar, o.nota ?? null],
    );
    // Sin user_id: lo cambió HealthFlow, no una persona de la clínica.
    await client.query(
      `INSERT INTO audit_log (tenant_id, user_id, entidad, accion, detalle)
       VALUES ($1, NULL, 'notas_v2_rollout', $2, $3::jsonb)`,
      [
        o.tenant,
        o.habilitar ? 'activar' : 'desactivar',
        JSON.stringify({ especialidad: o.especialidad, nota: o.nota ?? null }),
      ],
    );
    await client.query('COMMIT');
    console.log(`✓ notas_v2 ${o.especialidad}: ${o.habilitar ? 'encendido' : 'apagado'}`);
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
    `SELECT especialidad, habilitado, nota, cambiado_at
       FROM notas_v2_rollout WHERE tenant_id=$1 ORDER BY especialidad`,
    [tenant],
  );
  if (filas.rowCount === 0) console.log('(sin filas: notas_v2 apagado en todas las especialidades)');
  else console.table(filas.rows);
  console.log('Catálogo v1:');
  console.table(
    Object.entries(CATALOGO_NOTAS_V1.especialidades).map(([especialidad, c]) => ({
      especialidad,
      estado: c.estado,
      aprobacion: c.aprobacion?.referencia ?? '—',
    })),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
