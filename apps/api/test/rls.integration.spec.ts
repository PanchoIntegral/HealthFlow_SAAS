import { sql } from 'drizzle-orm';
import { loadDotEnv } from '../src/config/env';
import { createAppDb, createAdminDb, runInTenant } from '../src/db/drizzle';
import { patients } from '../src/db/schema';

loadDotEnv();

/**
 * Verifica la BARRERA de base de datos (RLS), independiente del código de app.
 * Requiere `pnpm db:setup && pnpm db:migrate && pnpm db:seed` previos.
 */
describe('Row-Level Security (aislamiento multi-tenant)', () => {
  const admin = createAdminDb();
  const app = createAppDb();
  let tenantNorte: string;
  let tenantSur: string;

  beforeAll(async () => {
    const rows = (
      await admin.db.execute(sql`SELECT id, plan FROM tenants WHERE plan IN ('pro','free')`)
    ).rows as unknown as { id: string; plan: string }[];
    tenantNorte = rows.find((r) => r.plan === 'pro')!.id;
    tenantSur = rows.find((r) => r.plan === 'free')!.id;
  });

  afterAll(async () => {
    await admin.pool.end();
    await app.pool.end();
  });

  it('sin tenant activo NO devuelve filas (deny por defecto)', async () => {
    const rows = await app.db.select().from(patients); // fuera de runInTenant → sin set_config
    expect(rows).toHaveLength(0);
  });

  it('con tenant Norte solo ve pacientes de Norte', async () => {
    const nombres = await runInTenant(app.db, tenantNorte, async (tx) => {
      const rows = await tx.select().from(patients);
      return rows.map((r) => r.nombre).sort();
    });
    expect(nombres).toContain('Roberto Fernández');
    expect(nombres.some((n) => n.startsWith('Paciente Confidencial'))).toBe(false);
  });

  it('el paciente confidencial de Sur es invisible desde Norte', async () => {
    const count = await runInTenant(app.db, tenantNorte, async (tx) => {
      const rows = await tx.execute(
        sql`SELECT count(*)::int AS n FROM patients WHERE nombre LIKE 'Paciente Confidencial%'`,
      );
      return (rows.rows[0] as { n: number }).n;
    });
    expect(count).toBe(0);
  });

  it('desde Sur sí ve a su paciente confidencial (control positivo)', async () => {
    const count = await runInTenant(app.db, tenantSur, async (tx) => {
      const rows = await tx.execute(
        sql`SELECT count(*)::int AS n FROM patients WHERE nombre LIKE 'Paciente Confidencial%'`,
      );
      return (rows.rows[0] as { n: number }).n;
    });
    expect(count).toBe(1);
  });

  it('un INSERT cruzado (tenant ajeno) es rechazado por WITH CHECK', async () => {
    await expect(
      runInTenant(app.db, tenantNorte, async (tx) => {
        await tx.insert(patients).values({
          tenantId: tenantSur, // intento de escribir en otro tenant
          nombre: 'Intruso',
          fechaNacimiento: '2000-01-01',
        });
      }),
    ).rejects.toThrow(/row-level security/i);
  });
});
