import { sql } from 'drizzle-orm';
import { loadDotEnv } from '../src/config/env';
import { createAppDb, createAdminDb, runInTenant } from '../src/db/drizzle';
import { TurnoCaja } from '../src/modules/caja/domain/turno-caja.entity';
import { DrizzleTurnoCajaRepository } from '../src/modules/caja/infrastructure/turno-caja.drizzle-repo';

loadDotEnv();

/**
 * Verifica el adaptador de caja contra Postgres real: el ida y vuelta del
 * agregado, la garantía de "una sola caja abierta" que vive en el índice único
 * parcial, y el aislamiento por tenant. Las reglas de negocio se prueban
 * aparte, sin base de datos, en turno-caja.domain.spec.ts.
 *
 * Requiere `pnpm db:setup && pnpm db:migrate && pnpm db:seed` previos.
 */
describe('Caja (persistencia)', () => {
  const admin = createAdminDb();
  const app = createAppDb();
  const repo = new DrizzleTurnoCajaRepository();

  let tenantNorte: string;
  let tenantSur: string;
  let userNorte: string;
  const turnosCreados: string[] = [];

  const abrirTurno = async (tenantId: string, userId: string, fondo = 50_000) =>
    runInTenant(app.db, tenantId, async (tx) => {
      const turno = TurnoCaja.abrir({ abiertaPor: userId, fondoInicialCentavos: fondo });
      const id = await repo.abrir(tx, turno);
      turnosCreados.push(id);
      return id;
    });

  beforeAll(async () => {
    const tenants = (
      await admin.db.execute(sql`SELECT id, plan FROM tenants WHERE plan IN ('pro','free')`)
    ).rows as unknown as { id: string; plan: string }[];
    tenantNorte = tenants.find((t) => t.plan === 'pro')!.id;
    tenantSur = tenants.find((t) => t.plan === 'free')!.id;

    const users = (
      await admin.db.execute(sql`SELECT id FROM users WHERE tenant_id = ${tenantNorte} LIMIT 1`)
    ).rows as unknown as { id: string }[];
    userNorte = users[0]!.id;

    // El seed puede dejar cajas abiertas de corridas anteriores; el índice
    // único parcial haría fallar la primera apertura de esta suite.
    await admin.db.execute(sql`DELETE FROM caja_movimientos`);
    await admin.db.execute(sql`DELETE FROM caja_turnos`);
  });

  afterAll(async () => {
    if (turnosCreados.length > 0) {
      await admin.db.execute(sql`DELETE FROM caja_movimientos`);
      await admin.db.execute(sql`DELETE FROM caja_turnos`);
    }
    await admin.pool.end();
    await app.pool.end();
  });

  it('guarda y relee el turno con sus movimientos y su corte', async () => {
    const id = await abrirTurno(tenantNorte, userNorte);

    await runInTenant(app.db, tenantNorte, async (tx) => {
      const turno = (await repo.findAbierto(tx))!;
      turno.registrarMovimiento({
        tipo: 'ingreso',
        concepto: 'Consulta general',
        montoCentavos: 80_000,
        metodo: 'efectivo',
        registradoPor: userNorte,
      });
      turno.registrarMovimiento({
        tipo: 'ingreso',
        concepto: 'Limpieza',
        montoCentavos: 120_000,
        metodo: 'tarjeta',
        registradoPor: userNorte,
      });
      turno.registrarMovimiento({
        tipo: 'retiro',
        concepto: 'Depósito bancario',
        montoCentavos: 30_000,
        metodo: 'efectivo',
        registradoPor: userNorte,
      });
      await repo.guardar(tx, turno);
    });

    const vista = await runInTenant(app.db, tenantNorte, (tx) => repo.vistaDe(tx, id));

    expect(vista!.abierta).toBe(true);
    expect(vista!.movimientos).toHaveLength(3);
    expect(vista!.resumen.ingresosCentavos).toBe(200_000);
    expect(vista!.resumen.retirosCentavos).toBe(30_000);
    // Solo el efectivo pasa por el cajón: 50000 + 80000 − 30000.
    expect(vista!.resumen.efectivoEsperadoCentavos).toBe(100_000);
    // `bigint` llega como string desde node-postgres: si la conversión fallara,
    // esto sería una concatenación de texto y no un número.
    expect(typeof vista!.movimientos[0]!.montoCentavos).toBe('number');
    // El nombre del usuario viene del JOIN, no del agregado.
    expect(vista!.movimientos[0]!.registradoPorNombre).toBeTruthy();
  });

  it('la corrección y la cancelación de un movimiento persisten', async () => {
    const id = await runInTenant(app.db, tenantNorte, async (tx) => {
      const turno = (await repo.findAbierto(tx))!;
      const m = turno.movimientos[0]!;
      turno.actualizarMovimiento(m.id, { concepto: 'Consulta de valoración' });
      turno.cancelarMovimiento(turno.movimientos[1]!.id, {
        motivo: 'Se capturó dos veces',
        canceladoPor: userNorte,
      });
      await repo.guardar(tx, turno);
      return turno.id;
    });

    const vista = await runInTenant(app.db, tenantNorte, (tx) => repo.vistaDe(tx, id));

    expect(vista!.movimientos[0]!.concepto).toBe('Consulta de valoración');
    expect(vista!.movimientos[1]!.canceladoEn).not.toBeNull();
    expect(vista!.movimientos[1]!.motivoCancelacion).toBe('Se capturó dos veces');
    expect(vista!.movimientos[1]!.canceladoPorNombre).toBeTruthy();
    // El cancelado (los $1,200 con tarjeta) deja de sumar al corte.
    expect(vista!.resumen.ingresosCentavos).toBe(80_000);
  });

  it('no permite dos cajas abiertas a la vez en la misma clínica', async () => {
    // La garantía es el índice único parcial `caja_turnos_abierta_uq`: aquí se
    // salta a propósito la comprobación del caso de uso para probar la barrera.
    await expect(abrirTurno(tenantNorte, userNorte)).rejects.toThrow();
  });

  it('el cierre guarda el efectivo contado y deja la caja lista para otro turno', async () => {
    const id = await runInTenant(app.db, tenantNorte, async (tx) => {
      const turno = (await repo.findAbierto(tx))!;
      turno.cerrar({
        cerradaPor: userNorte,
        efectivoContadoCentavos: turno.resumen.efectivoEsperadoCentavos - 5_000,
        notas: 'Faltaron $50',
      });
      await repo.guardar(tx, turno);
      return turno.id;
    });

    const vista = await runInTenant(app.db, tenantNorte, (tx) => repo.vistaDe(tx, id));
    expect(vista!.abierta).toBe(false);
    expect(vista!.resumen.diferenciaCentavos).toBe(-5_000);
    expect(vista!.cerradaPorNombre).toBeTruthy();

    // Turno cerrado: el índice parcial ya no estorba y se puede abrir otro.
    const siguiente = await abrirTurno(tenantNorte, userNorte, 0);
    expect(siguiente).toBeTruthy();
  });

  it('el histórico devuelve los cortes con su resumen ya calculado', async () => {
    const cortes = await runInTenant(app.db, tenantNorte, (tx) => repo.listarTurnos(tx, {}));

    expect(cortes.length).toBeGreaterThanOrEqual(2);
    // Del más reciente al más viejo: el turno abierto encabeza la lista.
    expect(cortes[0]!.abierta).toBe(true);
    const cerrado = cortes.find((c) => !c.abierta)!;
    expect(cerrado.resumen.ingresosCentavos).toBe(80_000);
  });

  it('la caja de otra clínica es invisible (RLS)', async () => {
    const desdeSur = await runInTenant(app.db, tenantSur, async (tx) => ({
      abierto: await repo.findAbierto(tx),
      cortes: await repo.listarTurnos(tx, {}),
    }));

    // Norte tiene un turno abierto y varios cortes; desde Sur no existe ninguno.
    expect(desdeSur.abierto).toBeNull();
    expect(desdeSur.cortes).toHaveLength(0);
  });
});
