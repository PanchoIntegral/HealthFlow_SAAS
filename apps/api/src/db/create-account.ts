/**
 * Alta manual de una cuenta (tenant + usuario médico), sin pasar por Stripe.
 * Pensado para cuentas de demo, pruebas en producción y altas de cortesía.
 *
 * Reproduce exactamente lo que hace `provisionTenant` en el webhook de Stripe
 * (ver handle-stripe-webhook.use-case.ts): tenant con su plan y periodo, y un
 * usuario con rol 'admin' + es_medico=true — quien es dueño de la cuenta es a
 * la vez el médico que atiende, así que necesita permisos completos Y aparecer
 * en la lista de médicos al agendar. La única diferencia es que aquí no hay
 * stripe_customer_id ni stripe_subscription_id: es una cuenta que no cobra.
 *
 * Uso:
 *   pnpm --filter @healthflow/api db:create-account \
 *     --email dra.lopez@clinica.mx --nombre "Dra. Ana López" --clinica "Clínica Demo"
 *
 * Opcionales: --plan individual|consultorio  --periodo mensual|anual
 *             --cedula 1234567  --especialidad "Medicina Interna"  --rfc XAXX010101000
 *             --con-datos-demo   (pacientes y citas de ejemplo, ver más abajo)
 *
 * La contraseña sale de la variable de entorno DEMO_PASSWORD; si no está, se
 * genera una aleatoria fuerte y se imprime UNA sola vez. No se pasa por
 * argumento a propósito: los argumentos quedan en el historial del shell y en
 * la lista de procesos.
 *
 * Contra producción: DATABASE_URL/DB_ADMIN_URL deben apuntar a la base de prod.
 *   DB_ADMIN_URL='postgres://...' pnpm --filter @healthflow/api db:create-account ...
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';
import { loadDotEnv, env } from '../config/env';

loadDotEnv();

const PLANES = ['individual', 'consultorio'] as const;
const PERIODOS = ['mensual', 'anual'] as const;

interface Args {
  email: string;
  nombre: string;
  clinica: string;
  plan: (typeof PLANES)[number];
  periodo: (typeof PERIODOS)[number];
  cedula?: string;
  especialidad?: string;
  rfc?: string;
  conDatosDemo: boolean;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string>();
  let conDatosDemo = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) continue;
    if (arg === '--con-datos-demo') {
      conDatosDemo = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`El argumento ${arg} necesita un valor`);
    }
    flags.set(arg.slice(2), value);
    i++;
  }

  const email = flags.get('email')?.trim().toLowerCase();
  const nombre = flags.get('nombre')?.trim();
  const clinica = flags.get('clinica')?.trim();

  if (!email || !nombre || !clinica) {
    throw new Error(
      'Faltan argumentos obligatorios.\n' +
        '  --email <correo>  --nombre "<nombre del médico>"  --clinica "<nombre de la clínica>"',
    );
  }
  // Validación deliberadamente laxa: solo atrapa el dedazo evidente. El email
  // de una cuenta de cortesía no tiene por qué existir en un buzón real.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`El email "${email}" no tiene forma de correo`);
  }

  const plan = flags.get('plan') ?? 'individual';
  if (!PLANES.includes(plan as never)) {
    throw new Error(`--plan debe ser uno de: ${PLANES.join(', ')}`);
  }
  const periodo = flags.get('periodo') ?? 'mensual';
  if (!PERIODOS.includes(periodo as never)) {
    throw new Error(`--periodo debe ser uno de: ${PERIODOS.join(', ')}`);
  }

  return {
    email,
    nombre,
    clinica,
    plan: plan as Args['plan'],
    periodo: periodo as Args['periodo'],
    cedula: flags.get('cedula')?.trim(),
    especialidad: flags.get('especialidad')?.trim(),
    rfc: flags.get('rfc')?.trim().toUpperCase(),
    conDatosDemo,
  };
}

/** Contraseña legible pero con ~96 bits de entropía. */
function generarPassword(): string {
  return randomBytes(12).toString('base64url');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const passwordDesdeEnv = process.env.DEMO_PASSWORD;
  const password = passwordDesdeEnv ?? generarPassword();
  if (password.length < 6) {
    throw new Error('DEMO_PASSWORD debe tener al menos 6 caracteres (lo exige LoginDto)');
  }

  const client = new Client({ connectionString: env.adminDatabaseUrl });
  await client.connect();

  try {
    /**
     * El email NO es único global a propósito (el mismo correo puede ser dueño
     * de dos clínicas), pero avisar evita crear un duplicado por accidente y
     * luego no entender por qué el login entra a la cuenta equivocada.
     *
     * Vía auth_find_user_by_email y no con un JOIN a mano: es una búsqueda
     * cross-tenant, y aquí todavía no hay tenant fijado. Con un SELECT normal,
     * RLS devolvería cero filas sin error — el aviso no saltaría nunca al
     * conectarse con el rol de aplicación. Esa función es SECURITY DEFINER
     * justo para este caso (ver 0002_auth_login.sql).
     */
    const existentes = await client.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM auth_find_user_by_email($1)`,
      [args.email],
    );
    if (existentes.rowCount) {
      console.warn(`⚠  ${args.email} ya existe en ${existentes.rowCount} clínica(s):`);
      for (const row of existentes.rows) console.warn(`     tenant_id ${row.tenant_id}`);
      console.warn('   Se creará OTRA cuenta con el mismo correo en una clínica distinta.');
      console.warn('   Al iniciar sesión entrará a aquella cuya contraseña coincida.\n');
    }

    const tenantId = randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);

    await client.query('BEGIN');
    /**
     * Fija el tenant activo de la transacción. Sin esto los INSERT fallan
     * contra las políticas RLS: `tenants` y `users` llevan FORCE ROW LEVEL
     * SECURITY, que aplica incluso al dueño de la tabla — y el rol admin de un
     * Postgres gestionado (Neon, Supabase, RDS) normalmente NO es superusuario,
     * así que no se la salta. Mismo patrón que runInTenant().
     */
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

    await client.query(
      `INSERT INTO tenants (id, nombre_clinica, rfc, plan, subscription_status, billing_period)
       VALUES ($1, $2, $3, $4, 'active', $5)`,
      [tenantId, args.clinica, args.rfc ?? null, args.plan, args.periodo],
    );

    const userId = (
      await client.query<{ id: string }>(
        `INSERT INTO users (tenant_id, email, password_hash, nombre, rol, es_medico,
                            cedula_profesional, especialidad)
         VALUES ($1, $2, $3, $4, 'admin', true, $5, $6)
         RETURNING id`,
        [
          tenantId,
          args.email,
          passwordHash,
          args.nombre,
          args.cedula ?? null,
          args.especialidad ?? null,
        ],
      )
    ).rows[0]!.id;

    if (args.conDatosDemo) {
      await sembrarDatosDemo(client, tenantId, userId);
    }

    await client.query('COMMIT');

    console.log('\n✓ Cuenta creada\n');
    console.log(`  Clínica     ${args.clinica}  (${args.plan} · ${args.periodo})`);
    console.log(`  Médico      ${args.nombre}`);
    console.log(`  Email       ${args.email}`);
    if (passwordDesdeEnv) {
      console.log('  Contraseña  (la que pasaste en DEMO_PASSWORD)');
    } else {
      console.log(`  Contraseña  ${password}`);
      console.log('\n  ⚠  Se muestra UNA sola vez: en la base solo queda el hash bcrypt.');
    }
    console.log(`  tenant_id   ${tenantId}`);
    if (args.conDatosDemo) console.log('\n  Datos de ejemplo cargados (pacientes, agenda e historial).');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

/**
 * Pacientes, agenda de hoy e historial de la semana pasada, para que la app no
 * se vea vacía en una demo: la sala de espera tiene a quién recibir, la agenda
 * tiene citas y el dashboard tiene de qué sacar métricas.
 *
 * Todo cuelga del tenant recién creado, así que RLS lo mantiene invisible para
 * cualquier otra clínica de la misma base.
 */
async function sembrarDatosDemo(client: Client, tenantId: string, doctorId: string): Promise<void> {
  const pacientes = [
    ['Roberto Fernández Ruiz', '1972-03-15', 'Control de hipertensión'],
    ['Lucía Márquez Ibarra', '1988-07-22', 'Cefalea recurrente'],
    ['José Antonio Ramírez', '1965-01-09', 'DM2 · Seguimiento'],
    ['Carmen Delgado Ponce', '1994-11-30', 'Primera vez'],
  ] as const;

  const patientIds: string[] = [];
  for (const [nombre, fechaNacimiento, motivo] of pacientes) {
    const patientId = (
      await client.query<{ id: string }>(
        `INSERT INTO patients (tenant_id, nombre, fecha_nacimiento) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, nombre, fechaNacimiento],
      )
    ).rows[0]!.id;
    patientIds.push(patientId);

    // Cita de hoy, lista para hacerle check-in en vivo durante la demo.
    await client.query(
      `INSERT INTO appointments (tenant_id, patient_id, doctor_id, motivo,
                                 inicio_programado, fin_programado, estatus)
       VALUES ($1, $2, $3, $4, now() + interval '30 min', now() + interval '50 min', 'agendada')`,
      [tenantId, patientId, doctorId, motivo],
    );
  }

  // Historial de los 6 días previos: consultas finalizadas con duración real
  // (de ahí salen los promedios del dashboard) y alguna inasistencia.
  const motivos = ['Control', 'Seguimiento DM2', 'Cefalea', 'Revisión', 'Dislipidemia'];
  for (let dia = 6; dia >= 1; dia--) {
    const citasEseDia = 3 + (dia % 4);
    for (let k = 0; k < citasEseDia; k++) {
      const patientId = patientIds[k % patientIds.length]!;
      const motivo = motivos[k % motivos.length]!;
      const inicio = `now()::date - interval '${dia} days' + interval '${9 + k} hours'`;
      const noAsistio = (dia + k) % 7 === 0; // ~1 de cada 7
      const duracion = 15 + ((dia * 7 + k * 3) % 20); // 15–34 min

      if (noAsistio) {
        await client.query(
          `INSERT INTO appointments (tenant_id, patient_id, doctor_id, motivo,
                                     inicio_programado, fin_programado, estatus)
           VALUES ($1, $2, $3, $4, ${inicio}, ${inicio} + interval '20 min', 'no_asistio')`,
          [tenantId, patientId, doctorId, motivo],
        );
      } else {
        await client.query(
          `INSERT INTO appointments (tenant_id, patient_id, doctor_id, motivo,
                                     inicio_programado, fin_programado, estatus,
                                     checkin_at, inicio_real, fin_real)
           VALUES ($1, $2, $3, $4, ${inicio}, ${inicio} + interval '30 min', 'finalizada',
                   ${inicio} - interval '10 min', ${inicio}, ${inicio} + interval '${duracion} min')`,
          [tenantId, patientId, doctorId, motivo],
        );
      }
    }
  }
}

main().catch((err: unknown) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
