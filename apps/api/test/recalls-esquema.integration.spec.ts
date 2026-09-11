import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { loadDotEnv } from '../src/config/env';
import { createAdminDb, createAppDb, runInTenant } from '../src/db/drizzle';

loadDotEnv();

/**
 * Esquema de Recall (migración 0048). Lo que se verifica aquí NO se puede
 * verificar sin PostgreSQL: el aislamiento RLS, el índice único parcial que
 * impide dos controles vivos equivalentes, las invariantes de estado escritas
 * como CHECK, y los permisos que el rol de la aplicación y el del worker
 * tienen de verdad.
 *
 * La máquina de estados se prueba aparte, sin base de datos
 * (src/modules/recalls/domain/recall.domain.spec.ts).
 */
describe('Esquema de Recall', () => {
  const admin = createAdminDb();
  const appDb = createAppDb();

  const norte = randomUUID();
  const sur = randomUUID();
  const pacienteNorte = randomUUID();
  const pacienteSur = randomUUID();
  const doctorNorte = randomUUID();
  let tipoNorte: string;

  beforeAll(async () => {
    for (const [id, nombre] of [
      [norte, 'Recall Norte'],
      [sur, 'Recall Sur'],
    ] as const) {
      await admin.db.execute(sql`
        INSERT INTO tenants (id, nombre_clinica, plan, subscription_status)
        VALUES (${id}::uuid, ${nombre}, 'clinica', 'active')
      `);
    }
    await admin.db.execute(sql`
      INSERT INTO users (id, tenant_id, email, password_hash, nombre, rol, es_medico)
      VALUES (${doctorNorte}::uuid, ${norte}::uuid, ${`rc-${doctorNorte}@test.mx`}, 'x', 'Dra. Norte', 'admin', true)
    `);
    await admin.db.execute(sql`
      INSERT INTO patients (id, tenant_id, nombre, fecha_nacimiento)
      VALUES (${pacienteNorte}::uuid, ${norte}::uuid, 'Paciente Norte', '1990-01-01'),
             (${pacienteSur}::uuid, ${sur}::uuid, 'Paciente Sur', '1990-01-01')
    `);

    tipoNorte = await runInTenant(appDb.db, norte, async (tx) => {
      const row = (
        await tx.execute(sql`
          INSERT INTO recall_types (nombre, interval_months) VALUES ('Limpieza', 6) RETURNING id
        `)
      ).rows[0] as { id: string };
      return row.id;
    });
  });

  afterAll(async () => {
    for (const id of [norte, sur]) {
      await admin.db.execute(sql`DELETE FROM recall_attempts WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM patient_recalls WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM recall_types WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM patients WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM users WHERE tenant_id=${id}::uuid`);
      await admin.db.execute(sql`DELETE FROM tenants WHERE id=${id}::uuid`);
    }
    await admin.pool.end();
    await appDb.pool.end();
  });

  const crearRecall = (
    tenant: string,
    paciente: string,
    tipo: string,
    status = 'pending',
    due = '2027-03-11',
  ) =>
    runInTenant(appDb.db, tenant, async (tx) => {
      const row = (
        await tx.execute(sql`
          INSERT INTO patient_recalls (patient_id, recall_type_id, source, due_date, status,
                                       completed_at, appointment_id)
          VALUES (${paciente}::uuid, ${tipo}::uuid, 'procedimiento', ${due}::date, ${status},
                  ${status === 'completed' ? sql`now()` : sql`NULL`}, NULL)
          RETURNING id
        `)
      ).rows[0] as { id: string };
      return row.id;
    });

  describe('aislamiento', () => {
    it('un control de una clínica es invisible para la otra', async () => {
      await crearRecall(norte, pacienteNorte, tipoNorte);
      const n = await runInTenant(appDb.db, sur, async (tx) =>
        ((await tx.execute(sql`SELECT count(*)::int n FROM patient_recalls`)).rows[0] as { n: number }).n,
      );
      expect(n).toBe(0);
    });

    it('no se puede colgar un control del paciente de otra clínica', async () => {
      // La FK sola no alcanza: las comprobaciones de llave foránea no pasan
      // por RLS. Lo atrapa el trigger de coherencia de tenant.
      await expect(
        runInTenant(appDb.db, norte, (tx) =>
          tx.execute(sql`
            INSERT INTO patient_recalls (patient_id, recall_type_id, source, due_date)
            VALUES (${pacienteSur}::uuid, ${tipoNorte}::uuid, 'manual', '2027-01-01'::date)
          `),
        ),
      ).rejects.toThrow(/patient does not belong/i);
    });

    it('ni usar el tipo de control de otra clínica', async () => {
      const tipoSur = await runInTenant(appDb.db, sur, async (tx) =>
        ((await tx.execute(sql`
          INSERT INTO recall_types (nombre, interval_months) VALUES ('Limpieza Sur', 6) RETURNING id
        `)).rows[0] as { id: string }).id,
      );
      await expect(
        runInTenant(appDb.db, norte, (tx) =>
          tx.execute(sql`
            INSERT INTO patient_recalls (patient_id, recall_type_id, source, due_date)
            VALUES (${pacienteNorte}::uuid, ${tipoSur}::uuid, 'manual', '2027-01-01'::date)
          `),
        ),
      ).rejects.toThrow(/recall type does not belong/i);
    });
  });

  describe('un solo control vivo por paciente y tipo', () => {
    it('rechaza el segundo control vivo equivalente', async () => {
      // Es la segunda capa de idempotencia: cubre dos eventos DISTINTOS que
      // pedirían el mismo control (dos limpiezas terminadas el mismo día).
      await expect(crearRecall(norte, pacienteNorte, tipoNorte)).rejects.toThrow(
        /duplicate key|unique/i,
      );
    });

    it('un control cerrado deja sitio al siguiente ciclo', async () => {
      await runInTenant(appDb.db, norte, (tx) =>
        tx.execute(sql`
          UPDATE patient_recalls SET status='completed', completed_at=now()
           WHERE patient_id=${pacienteNorte}::uuid
        `),
      );
      const nuevo = await crearRecall(norte, pacienteNorte, tipoNorte);
      expect(nuevo).toBeDefined();
      const vivos = await runInTenant(appDb.db, norte, async (tx) =>
        ((await tx.execute(sql`
          SELECT count(*)::int n FROM patient_recalls
           WHERE patient_id=${pacienteNorte}::uuid
             AND status IN ('pending','due','contacted','scheduled')
        `)).rows[0] as { n: number }).n,
      );
      expect(vivos).toBe(1);
    });
  });

  describe('invariantes de estado en SQL', () => {
    it('completado exige fecha de cierre, y sin cerrar no la admite', async () => {
      await expect(
        runInTenant(appDb.db, norte, (tx) =>
          tx.execute(sql`
            UPDATE patient_recalls SET status='completed', completed_at=NULL
             WHERE patient_id=${pacienteNorte}::uuid AND status='pending'
          `),
        ),
      ).rejects.toThrow(/patient_recalls_completado_chk/i);
    });

    it('agendado exige una cita', async () => {
      await expect(
        runInTenant(appDb.db, norte, (tx) =>
          tx.execute(sql`
            UPDATE patient_recalls SET status='scheduled'
             WHERE patient_id=${pacienteNorte}::uuid AND status='pending'
          `),
        ),
      ).rejects.toThrow(/patient_recalls_agendado_chk/i);
    });

    it('el motivo de descarte no sobrevive a un control que no fue descartado', async () => {
      await expect(
        runInTenant(appDb.db, norte, (tx) =>
          tx.execute(sql`
            UPDATE patient_recalls SET dismiss_reason='porque sí'
             WHERE patient_id=${pacienteNorte}::uuid AND status='pending'
          `),
        ),
      ).rejects.toThrow(/patient_recalls_descartado_chk/i);
    });

    it('un intento cerrado exige resultado', async () => {
      const recall = await runInTenant(appDb.db, norte, async (tx) =>
        ((await tx.execute(sql`
          SELECT id FROM patient_recalls WHERE patient_id=${pacienteNorte}::uuid AND status='pending' LIMIT 1
        `)).rows[0] as { id: string }).id,
      );
      await expect(
        runInTenant(appDb.db, norte, (tx) =>
          tx.execute(sql`
            INSERT INTO recall_attempts (patient_recall_id, channel, attempt_number, status, scheduled_at)
            VALUES (${recall}::uuid, 'phone', 1, 'closed', now())
          `),
        ),
      ).rejects.toThrow(/recall_attempts_cerrado_chk/i);
    });

    it('no hay dos intentos con el mismo número', async () => {
      const recall = await runInTenant(appDb.db, norte, async (tx) =>
        ((await tx.execute(sql`
          SELECT id FROM patient_recalls WHERE patient_id=${pacienteNorte}::uuid AND status='pending' LIMIT 1
        `)).rows[0] as { id: string }).id,
      );
      await runInTenant(appDb.db, norte, (tx) =>
        tx.execute(sql`
          INSERT INTO recall_attempts (patient_recall_id, channel, attempt_number, scheduled_at)
          VALUES (${recall}::uuid, 'phone', 1, now())
        `),
      );
      await expect(
        runInTenant(appDb.db, norte, (tx) =>
          tx.execute(sql`
            INSERT INTO recall_attempts (patient_recall_id, channel, attempt_number, scheduled_at)
            VALUES (${recall}::uuid, 'email', 1, now())
          `),
        ),
      ).rejects.toThrow(/duplicate key|unique/i);
    });
  });

  describe('catálogo de tipos', () => {
    it('no admite dos tipos activos con el mismo nombre, ni por mayúsculas', async () => {
      await expect(
        runInTenant(appDb.db, norte, (tx) =>
          tx.execute(sql`INSERT INTO recall_types (nombre, interval_months) VALUES ('  LIMPIEZA ', 6)`),
        ),
      ).rejects.toThrow(/duplicate key|unique/i);
    });

    it('desactivar libera el nombre y conserva el histórico', async () => {
      await runInTenant(appDb.db, norte, (tx) =>
        tx.execute(sql`UPDATE recall_types SET activo=false WHERE id=${tipoNorte}::uuid`),
      );
      const nuevo = await runInTenant(appDb.db, norte, async (tx) =>
        ((await tx.execute(sql`
          INSERT INTO recall_types (nombre, interval_months) VALUES ('Limpieza', 4) RETURNING id
        `)).rows[0] as { id: string }).id,
      );
      expect(nuevo).not.toBe(tipoNorte);
      await runInTenant(appDb.db, norte, (tx) =>
        tx.execute(sql`UPDATE recall_types SET activo=false WHERE id=${nuevo}::uuid`),
      );
      await runInTenant(appDb.db, norte, (tx) =>
        tx.execute(sql`UPDATE recall_types SET activo=true WHERE id=${tipoNorte}::uuid`),
      );
    });

    it('un tipo con controles no se borra: se desactiva', async () => {
      // ON DELETE RESTRICT. Perder el historial de controles al limpiar un
      // catálogo sería un daño silencioso e irreversible.
      await expect(
        admin.db.execute(sql`DELETE FROM recall_types WHERE id=${tipoNorte}::uuid`),
      ).rejects.toThrow(/violates foreign key|restrict/i);
    });
  });

  describe('permisos', () => {
    it.each(['recall_types', 'patient_recalls', 'recall_attempts'])(
      'la aplicación no puede borrar de %s',
      async (tabla) => {
        await expect(
          runInTenant(appDb.db, norte, (tx) =>
            tx.execute(sql.raw(`DELETE FROM ${tabla} WHERE tenant_id = current_tenant_id()`)),
          ),
        ).rejects.toThrow(/permission denied/i);
      },
    );

    it('el worker tiene los permisos que sus consumidores van a necesitar', async () => {
      // Antes de 0048 el rol del worker no tenía NINGÚN permiso de tabla: el
      // despachador de eventos habría fallado en la primera lectura de negocio.
      const filas = (
        await admin.db.execute(sql`
          SELECT table_name, privilege_type FROM information_schema.role_table_grants
           WHERE grantee='healthflow_worker'
        `)
      ).rows as { table_name: string; privilege_type: string }[];
      const permisos = new Set(filas.map((f) => `${f.table_name}:${f.privilege_type}`));
      for (const p of [
        'patient_recalls:SELECT', 'patient_recalls:INSERT', 'patient_recalls:UPDATE',
        'recall_attempts:SELECT', 'recall_attempts:INSERT', 'recall_attempts:UPDATE',
        'recall_types:SELECT', 'patients:SELECT', 'appointments:SELECT', 'tenants:SELECT',
      ]) {
        expect(permisos).toContain(p);
      }
      // Y NO puede borrar controles.
      expect(permisos).not.toContain('patient_recalls:DELETE');
    });
  });
});
