/**
 * Seed de desarrollo: 2 clínicas (tenants) para poder demostrar el aislamiento
 * multi-tenant. Corre como rol admin (bypassa RLS para insertar en ambos).
 * Idempotente por email/nombre: borra y recrea los datos de demo.
 * Uso: pnpm --filter @healthflow/api db:seed
 */
import { Client } from 'pg';
import bcrypt from 'bcryptjs';
import { loadDotEnv, env } from '../config/env';

loadDotEnv();

const PASSWORD = 'password123';

async function main() {
  const c = new Client({ connectionString: env.adminDatabaseUrl });
  await c.connect();
  const hash = await bcrypt.hash(PASSWORD, 10);

  // Limpieza de datos de demo (respeta FKs por CASCADE desde tenants).
  await c.query(`DELETE FROM tenants WHERE nombre_clinica IN ('Clínica Norte', 'Clínica Sur')`);

  // ── Tenant A: Clínica Norte ────────────────────────────────────
  const tenantA = (
    await c.query(
      `INSERT INTO tenants(nombre_clinica, rfc, plan) VALUES ('Clínica Norte','NOR010101AAA','pro') RETURNING id`,
    )
  ).rows[0].id as string;

  const medicoA = (
    await c.query(
      `INSERT INTO users(tenant_id,email,password_hash,nombre,rol,cedula_profesional,especialidad)
       VALUES ($1,'dra.cervantes@norte.mx',$2,'Dra. Mariana Cervantes','medico','7841203','Medicina Interna') RETURNING id`,
      [tenantA, hash],
    )
  ).rows[0].id as string;

  await c.query(
    `INSERT INTO users(tenant_id,email,password_hash,nombre,rol)
     VALUES ($1,'asistente@norte.mx',$2,'Ana Torres','asistente')`,
    [tenantA, hash],
  );

  const patientsA = [
    ['Roberto Fernández', '1972-03-15', 'Control de hipertensión'],
    ['Lucía Márquez', '1988-07-22', 'Cefalea recurrente'],
    ['José Antonio Ramírez', '1965-01-09', 'DM2 · Seguimiento'],
  ] as const;

  const patientIdsA: string[] = [];
  for (const [nombre, fnac, motivo] of patientsA) {
    const patientId = (
      await c.query(
        `INSERT INTO patients(tenant_id,nombre,fecha_nacimiento) VALUES ($1,$2,$3) RETURNING id`,
        [tenantA, nombre, fnac],
      )
    ).rows[0].id as string;
    patientIdsA.push(patientId);

    // Cita agendada para hoy (lista para check-in).
    await c.query(
      `INSERT INTO appointments(tenant_id,patient_id,doctor_id,motivo,inicio_programado,fin_programado,estatus)
       VALUES ($1,$2,$3,$4, now() + interval '30 min', now() + interval '50 min', 'agendada')`,
      [tenantA, patientId, medicoA, motivo],
    );
  }

  // Historial de la semana para que el dashboard y los reportes muestren datos
  // realistas: citas finalizadas (con duración real y nota clínica cerrada
  // con diagnóstico CIE-10) y algunas no asistidas, repartidas en los
  // últimos 6 días.
  const motivosDemo = ['Control', 'Seguimiento DM2', 'Cefalea', 'Revisión', 'Dislipidemia'];
  const diagnosticosDemo = [
    { cie10: 'I10', descripcion: 'Hipertensión esencial (primaria)' },
    { cie10: 'E11.9', descripcion: 'Diabetes mellitus tipo 2, sin complicaciones' },
    { cie10: 'R51', descripcion: 'Cefalea' },
    { cie10: 'E78.5', descripcion: 'Hiperlipidemia, no especificada' },
    { cie10: 'E78.0', descripcion: 'Hipercolesterolemia pura' },
  ];

  for (let dia = 6; dia >= 1; dia--) {
    const citasEseDia = 3 + (dia % 4); // 3–6 citas por día
    for (let k = 0; k < citasEseDia; k++) {
      const patientId = patientIdsA[k % patientIdsA.length];
      const hora = 9 + k; // 9:00, 10:00, …
      const noShow = (dia + k) % 7 === 0; // ~1 de cada 7
      const durMin = 15 + ((dia * 7 + k * 3) % 20); // 15–34 min
      const inicioProg = `now()::date - interval '${dia} days' + interval '${hora} hours'`;
      const motivo = motivosDemo[k % motivosDemo.length]!;
      if (noShow) {
        await c.query(
          `INSERT INTO appointments(tenant_id,patient_id,doctor_id,motivo,inicio_programado,fin_programado,estatus)
           VALUES ($1,$2,$3,$4, ${inicioProg}, ${inicioProg} + interval '20 min', 'no_asistio')`,
          [tenantA, patientId, medicoA, motivo],
        );
      } else {
        const appointmentId = (
          await c.query(
            `INSERT INTO appointments(tenant_id,patient_id,doctor_id,motivo,inicio_programado,fin_programado,estatus,checkin_at,inicio_real,fin_real)
             VALUES ($1,$2,$3,$4, ${inicioProg}, ${inicioProg} + interval '30 min', 'finalizada',
                     ${inicioProg} - interval '10 min', ${inicioProg}, ${inicioProg} + interval '${durMin} min')
             RETURNING id`,
            [tenantA, patientId, medicoA, motivo],
          )
        ).rows[0].id as string;

        const recordId = (
          await c.query(
            `INSERT INTO clinical_records(tenant_id, patient_id) VALUES ($1,$2)
             ON CONFLICT (patient_id) DO UPDATE SET patient_id = EXCLUDED.patient_id
             RETURNING id`,
            [tenantA, patientId],
          )
        ).rows[0].id as string;

        const diag = diagnosticosDemo[k % diagnosticosDemo.length];
        const contenido = {
          tipoNota: 'nota_evolucion',
          padecimientoActual: `<p>Acude a consulta de seguimiento por ${motivo.toLowerCase()}. Refiere evolución favorable.</p>`,
          exploracionFisica: {
            signosVitales: { ta: '120/80', fc: '74', fr: '16', temp: '36.5', spo2: '98', peso: '70', talla: '1.70' },
            hallazgos: '',
          },
          diagnosticos: [diag],
          planTerapeutico: 'Continuar manejo actual. Cita de control en 3 meses.',
          firma: { medicoNombre: 'Dra. Mariana Cervantes', cedula: '7841203', fecha: new Date().toISOString() },
        };

        await c.query(
          `INSERT INTO clinical_notes(tenant_id, clinical_record_id, appointment_id, doctor_id, tipo_nota, contenido_nom004, estatus, cerrado_en)
           VALUES ($1,$2,$3,$4,'nota_evolucion',$5::jsonb,'cerrada', ${inicioProg} + interval '${durMin} min')`,
          [tenantA, recordId, appointmentId, medicoA, JSON.stringify(contenido)],
        );
      }
    }
  }

  // ── Tenant B: Clínica Sur (para probar aislamiento) ────────────
  const tenantB = (
    await c.query(
      `INSERT INTO tenants(nombre_clinica, rfc, plan) VALUES ('Clínica Sur','SUR020202BBB','free') RETURNING id`,
    )
  ).rows[0].id as string;

  const medicoB = (
    await c.query(
      `INSERT INTO users(tenant_id,email,password_hash,nombre,rol,cedula_profesional)
       VALUES ($1,'dr.lopez@sur.mx',$2,'Dr. Carlos López','medico','9988776') RETURNING id`,
      [tenantB, hash],
    )
  ).rows[0].id as string;

  const patientB = (
    await c.query(
      `INSERT INTO patients(tenant_id,nombre,fecha_nacimiento) VALUES ($1,'Paciente Confidencial Sur','1990-05-05') RETURNING id`,
      [tenantB],
    )
  ).rows[0].id as string;

  await c.query(
    `INSERT INTO appointments(tenant_id,patient_id,doctor_id,motivo,inicio_programado,fin_programado,estatus)
     VALUES ($1,$2,$3,'Valoración', now(), now() + interval '20 min', 'agendada')`,
    [tenantB, patientB, medicoB],
  );

  await c.end();

  console.log(`
✓ Seed completo.

  Clínica Norte  (tenant ${tenantA})
    médico     dra.cervantes@norte.mx  /  ${PASSWORD}
    asistente  asistente@norte.mx      /  ${PASSWORD}
    3 pacientes con cita 'agendada' lista para check-in

  Clínica Sur    (tenant ${tenantB})
    médico     dr.lopez@sur.mx         /  ${PASSWORD}
    1 paciente confidencial (NO debe verse desde Clínica Norte)
`);
}

main().catch((err) => {
  console.error('✗ seed falló:', err);
  process.exit(1);
});
