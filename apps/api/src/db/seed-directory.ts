/**
 * Seed de desarrollo del directorio público de reservas.
 *
 * Crea dos clínicas que sólo se distinguen por el consentimiento de
 * publicación, para poder comprobar a simple vista que el opt-in manda:
 *   • «Directorio Demo Centro» — publicada y con `directorio_publico`.
 *   • «Directorio Demo Reservada» — publicada, pero SIN `directorio_publico`.
 * Únicamente la primera debe aparecer en GET /api/public/directory.
 *
 * Corre como rol admin (bypassa RLS para insertar en ambos tenants) y es
 * idempotente: borra y recrea sus propios tenants en cada ejecución.
 * Uso: pnpm --filter @healthflow/api db:seed:directory
 */
import { Client } from 'pg';
import bcrypt from 'bcryptjs';
import { loadDotEnv, env } from '../config/env';

loadDotEnv();

const PASSWORD = 'password123';

type DoctorSeed = { nombre: string; especialidad: string; email: string };

type ClinicSeed = {
  nombre: string;
  rfc: string;
  direccion: string;
  slug: string;
  directorio: boolean;
  doctores: DoctorSeed[];
};

const CLINICS: ClinicSeed[] = [
  {
    nombre: 'Directorio Demo Centro',
    rfc: 'DDC010101AAA',
    direccion: 'Av. Revolución 1200, Zona Centro, Tijuana, B.C.',
    slug: 'directorio-demo-centro',
    directorio: true,
    doctores: [
      { nombre: 'Dra. Ana López', especialidad: 'Pediatría', email: 'ana.lopez@demo-centro.test' },
      { nombre: 'Dr. Marco Ruiz', especialidad: 'Cardiología', email: 'marco.ruiz@demo-centro.test' },
      { nombre: 'Dra. Sofía Pérez', especialidad: 'Dermatología', email: 'sofia.perez@demo-centro.test' },
    ],
  },
  {
    nombre: 'Directorio Demo Reservada',
    rfc: 'DDR020202BBB',
    direccion: 'Blvd. Agua Caliente 450, Tijuana, B.C.',
    slug: 'directorio-demo-reservada',
    directorio: false,
    doctores: [
      { nombre: 'Dr. Hugo Salas', especialidad: 'Nutrición', email: 'hugo.salas@demo-reservada.test' },
    ],
  },
];

async function main() {
  const c = new Client({ connectionString: env.adminDatabaseUrl });
  await c.connect();
  const hash = await bcrypt.hash(PASSWORD, 10);

  await c.query(`DELETE FROM tenants WHERE nombre_clinica = ANY($1)`, [CLINICS.map((x) => x.nombre)]);

  for (const clinic of CLINICS) {
    const tenant = (
      await c.query(
        `INSERT INTO tenants(nombre_clinica, rfc, direccion, plan, subscription_status)
         VALUES ($1,$2,$3,'consultorio','trialing') RETURNING id`,
        [clinic.nombre, clinic.rfc, clinic.direccion],
      )
    ).rows[0].id as string;

    await c.query(
      `INSERT INTO booking_settings(tenant_id, slug, publicado, feature_activa, directorio_publico, timezone)
       VALUES ($1,$2,true,true,$3,'America/Tijuana')`,
      [tenant, clinic.slug, clinic.directorio],
    );

    const service = (
      await c.query(
        `INSERT INTO booking_services(tenant_id, nombre, duracion_minutos, publico, activo, orden)
         VALUES ($1,'Consulta general',30,true,true,0) RETURNING id`,
        [tenant],
      )
    ).rows[0].id as string;

    for (const doctor of clinic.doctores) {
      const doctorId = (
        await c.query(
          `INSERT INTO users(tenant_id,email,password_hash,nombre,rol,especialidad)
           VALUES ($1,$2,$3,$4,'medico',$5) RETURNING id`,
          [tenant, doctor.email, hash, doctor.nombre, doctor.especialidad],
        )
      ).rows[0].id as string;

      await c.query(
        `INSERT INTO booking_service_doctors(tenant_id, service_id, doctor_id) VALUES ($1,$2,$3)`,
        [tenant, service, doctorId],
      );

      // Lunes a viernes de 9 a 14 h: suficiente para que el flujo de reserva
      // devuelva slots reales al abrir el enlace desde la landing.
      for (const weekday of [1, 2, 3, 4, 5]) {
        await c.query(
          `INSERT INTO doctor_availability(tenant_id, doctor_id, weekday, inicio_local, fin_local)
           VALUES ($1,$2,$3,'09:00','14:00')`,
          [tenant, doctorId, weekday],
        );
      }
    }
  }

  const visible = (await c.query(`SELECT * FROM search_public_booking_directory('',NULL,24,0)`)).rows;
  const specialties = (await c.query(`SELECT * FROM list_public_booking_specialties()`)).rows;

  console.log(`
Seed del directorio listo.

  Visibles en el directorio: ${visible.length} profesional(es)
${visible.map((r) => `    · ${r.doctor_name} — ${r.specialty} @ ${r.clinic_name}`).join('\n')}

  Especialidades del filtro: ${specialties.map((r) => `${r.specialty} (${r.total})`).join(', ') || '—'}

  «Directorio Demo Reservada» NO debe aparecer arriba: está publicada pero sin opt-in.
  Contraseña de todas las cuentas: ${PASSWORD}
`);

  await c.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
