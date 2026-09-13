import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { EMPTY_HISTORIA_CLINICA, type NotaEvolucionContent } from '@healthflow/shared-types';
import { loadDotEnv, env } from '../src/config/env';
import { createAdminDb, createAppDb, runInTenant } from '../src/db/drizzle';
import { AppModule } from '../src/app.module';

loadDotEnv();

/**
 * Notas v2 (0053): el servidor estampa especialidad, contexto y plantilla al
 * crear el borrador, detrás de `notas_v2_rollout`, apagado por defecto.
 *
 * Requiere `pnpm db:setup && pnpm db:migrate` previos.
 */
describe('Notas v2: contexto por especialidad y activación gradual', () => {
  const admin = createAdminDb();
  const appDb = createAppDb();
  let app: INestApplication;

  const tenantId = randomUUID();
  const general = randomUUID();
  const cardio = randomUUID();
  const nutri = randomUUID();
  const tokens: Record<string, string> = {};
  let offset = 0;

  function auth(doctor: string) {
    return { Authorization: `Bearer ${tokens[doctor]}` };
  }

  async function nuevoPaciente(): Promise<string> {
    const id = randomUUID();
    await admin.db.execute(sql`
      INSERT INTO patients (id, tenant_id, nombre, fecha_nacimiento)
      VALUES (${id}::uuid, ${tenantId}::uuid, 'Paciente v2', '1970-01-01')
    `);
    return id;
  }

  async function flag(especialidad: string, habilitado: boolean) {
    await admin.db.execute(sql`
      INSERT INTO notas_v2_rollout (tenant_id, especialidad, habilitado, nota)
      VALUES (${tenantId}::uuid, ${especialidad}, ${habilitado}, 'prueba')
      ON CONFLICT (tenant_id, especialidad) DO UPDATE SET habilitado = EXCLUDED.habilitado
    `);
  }

  /** Agenda, check-in e inicio de consulta. Devuelve cita y fila estampada. */
  async function abrir(doctor: string, patientId: string) {
    offset += 40;
    const inicio = new Date(Date.now() + offset * 60_000);
    const { body: cita } = await request(app.getHttpServer())
      .post('/api/appointments')
      .set(auth(doctor))
      .send({
        patientId,
        doctorId: doctor,
        inicioProgramado: inicio.toISOString(),
        finProgramado: new Date(inicio.getTime() + 20 * 60_000).toISOString(),
      })
      .expect(201);
    await request(app.getHttpServer()).post(`/api/appointments/${cita.id}/check-in`).set(auth(doctor)).expect(201);
    const { body } = await request(app.getHttpServer())
      .post(`/api/appointments/${cita.id}/start-consultation`)
      .set(auth(doctor))
      .expect(201);
    return { citaId: cita.id as string, noteId: body.noteId as string, fila: await fila(body.noteId) };
  }

  async function fila(noteId: string) {
    const res = await runInTenant(appDb.db, tenantId, (tx) =>
      tx.execute(sql`
        SELECT tipo_nota, especialidad, contexto_nota, plantilla_version,
               contenido_nom004->>'plantillaVersion' AS plantilla_json,
               contenido_nom004->>'contextoNota' AS contexto_json
          FROM clinical_notes WHERE id = ${noteId}
      `),
    );
    return res.rows[0] as Record<string, string | null>;
  }

  /** Cierra con lo mínimo de NOM-004 (antecedentes incluidos si es historia). */
  async function cerrar(doctor: string, citaId: string) {
    const contenido: NotaEvolucionContent = {
      ...EMPTY_HISTORIA_CLINICA,
      padecimientoActual: '<p>Valoración</p>',
      exploracionFisica: {
        signosVitales: { ...EMPTY_HISTORIA_CLINICA.exploracionFisica.signosVitales, ta: '120/80' },
      },
      diagnosticos: [{ cie10: 'Z00.0', descripcion: 'Examen general' }],
      planTerapeutico: '<p>Plan</p>',
      antecedentesHeredofamiliares: '<p>Negados</p>',
      antecedentesPersonalesPatologicos: '<p>Negados</p>',
      antecedentesPersonalesNoPatologicos: '<p>Negados</p>',
      // Sólo cuenta en una inicial de especialidad; en las demás se ignora.
      verificacionAntecedentes: { estado: 'verificados_sin_cambios' },
    };
    await request(app.getHttpServer())
      .post(`/api/consultations/${citaId}/finish`)
      .set(auth(doctor))
      .send({ contenido })
      .expect(201);
  }

  beforeAll(async () => {
    await admin.db.execute(sql`
      INSERT INTO tenants (id, nombre_clinica, plan, subscription_status)
      VALUES (${tenantId}::uuid, 'Clínica Notas v2', 'consultorio', 'active')
    `);
    for (const [id, nombre, especialidad] of [
      [general, 'Dra. General', 'general'],
      [cardio, 'Dr. Cardio', 'cardiologia'],
      [nutri, 'Lic. Nutri', 'nutricion'],
    ] as const) {
      await admin.db.execute(sql`
        INSERT INTO users (id, tenant_id, email, password_hash, nombre, rol, es_medico, cedula_profesional, especialidad_key)
        VALUES (${id}::uuid, ${tenantId}::uuid, ${`${id}@test.mx`}, 'x', ${nombre}, 'admin', true, '7654321', ${especialidad})
      `);
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    const jwt = app.get(JwtService);
    for (const id of [general, cardio, nutri]) {
      tokens[id] = jwt.sign({ sub: id, tid: tenantId, rol: 'admin' }, { secret: env.jwtSecret });
    }
  });

  afterAll(async () => {
    for (const tabla of [
      'notas_v2_rollout',
      'notas_correccion',
      'clinical_notes',
      'clinical_records',
      'app_events',
      'appointments',
      'notifications',
      'audit_log',
      'patients',
      'users',
    ]) {
      await admin.db.execute(sql`DELETE FROM ${sql.identifier(tabla)} WHERE tenant_id = ${tenantId}::uuid`);
    }
    await admin.db.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`);
    await app?.close();
    await admin.pool.end();
    await appDb.pool.end();
  });

  it('apagado por defecto: la nota nace legacy, sin columnas ni plantilla en el contenido', async () => {
    const { fila: f } = await abrir(cardio, await nuevoPaciente());
    expect(f).toEqual({
      tipo_nota: 'historia_clinica',
      especialidad: null,
      contexto_nota: null,
      plantilla_version: null,
      plantilla_json: null,
      contexto_json: null,
    });
  });

  describe('con notas_v2 encendido para general y cardiología', () => {
    beforeAll(async () => {
      await flag('general', true);
      await flag('cardiologia', true);
    });

    it('recorre general → inicial de cardiología → seguimiento, cada paso estampado', async () => {
      const paciente = await nuevoPaciente();

      const primera = await abrir(cardio, paciente);
      expect(primera.fila).toMatchObject({
        tipo_nota: 'historia_clinica',
        especialidad: 'cardiologia',
        contexto_nota: 'general',
        plantilla_version: 'v1',
        plantilla_json: 'v1',
        contexto_json: 'general',
      });
      await cerrar(cardio, primera.citaId);

      // Ya tiene historia general, pero la valoración de ese día era la
      // general: la inicial de cardiología sigue pendiente.
      const segunda = await abrir(cardio, paciente);
      expect(segunda.fila).toMatchObject({ tipo_nota: 'historia_clinica', contexto_nota: 'inicial_especialidad' });
      await cerrar(cardio, segunda.citaId);

      const tercera = await abrir(cardio, paciente);
      expect(tercera.fila).toMatchObject({ tipo_nota: 'nota_evolucion', contexto_nota: 'seguimiento' });
    });

    it('la historia de medicina general no sustituye la primera valoración cardiológica', async () => {
      const paciente = await nuevoPaciente();
      const gral = await abrir(general, paciente);
      expect(gral.fila).toMatchObject({ contexto_nota: 'general', especialidad: 'general' });
      await cerrar(general, gral.citaId);

      expect((await abrir(general, paciente)).fila).toMatchObject({ contexto_nota: 'seguimiento' });
      expect((await abrir(cardio, paciente)).fila).toMatchObject({
        tipo_nota: 'historia_clinica',
        contexto_nota: 'inicial_especialidad',
      });
    });

    it('un borrador abandonado no cuenta como valoración', async () => {
      const paciente = await nuevoPaciente();
      await abrir(cardio, paciente); // se queda en borrador
      expect((await abrir(cardio, paciente)).fila).toMatchObject({ contexto_nota: 'general' });
    });

    it('una historia legacy firmada cuenta como general y como inicial de su especialidad', async () => {
      const paciente = await nuevoPaciente();
      await flag('cardiologia', false);
      const legacy = await abrir(cardio, paciente);
      expect(legacy.fila.plantilla_version).toBeNull();
      await cerrar(cardio, legacy.citaId);
      await flag('cardiologia', true);

      expect((await abrir(cardio, paciente)).fila).toMatchObject({ plantilla_version: 'v1', contexto_nota: 'seguimiento' });
      // …pero no es la inicial de otra especialidad.
      await flag('nutricion', true);
      expect((await abrir(nutri, paciente)).fila).toMatchObject({ contexto_nota: 'inicial_especialidad' });
      await flag('nutricion', false);
    });

    it('el flag es por especialidad: nutrición sigue legacy', async () => {
      const { fila: f } = await abrir(nutri, await nuevoPaciente());
      expect(f.plantilla_version).toBeNull();
    });

    it('reingresar al editor no recalcula ni reestampa', async () => {
      const paciente = await nuevoPaciente();
      const { citaId, noteId, fila: antes } = await abrir(cardio, paciente);
      await request(app.getHttpServer())
        .post(`/api/appointments/${citaId}/start-consultation`)
        .set(auth(cardio))
        .expect(201);
      expect(await fila(noteId)).toEqual(antes);
    });
  });

  describe('esquema calculado por la API', () => {
    it('la inicial de especialidad expone la verificación y los antecedentes vigentes como referencia', async () => {
      await flag('general', true);
      await flag('cardiologia', true);
      const paciente = await nuevoPaciente();
      const gral = await abrir(general, paciente);
      await request(app.getHttpServer())
        .post(`/api/consultations/${gral.citaId}/finish`)
        .set(auth(general))
        .send({
          contenido: {
            ...EMPTY_HISTORIA_CLINICA,
            padecimientoActual: '<p>Chequeo</p>',
            exploracionFisica: { signosVitales: { ...EMPTY_HISTORIA_CLINICA.exploracionFisica.signosVitales, ta: '118/76' } },
            diagnosticos: [{ cie10: 'Z00.0', descripcion: 'Examen general' }],
            planTerapeutico: '<p>Control anual</p>',
            antecedentesHeredofamiliares: '<p>Madre con DM2</p>',
            antecedentesPersonalesPatologicos: '<p>Apendicectomía 2010</p>',
            antecedentesPersonalesNoPatologicos: '<p>No fuma</p>',
          },
        })
        .expect(201);

      const { citaId } = await abrir(cardio, paciente);
      const { body } = await request(app.getHttpServer())
        .get(`/api/consultations/${citaId}/note`)
        .set(auth(cardio))
        .expect(200);

      const rutas = body.esquema.campos.map((c: { ruta: string }) => c.ruta);
      expect(rutas).toContain('verificacionAntecedentes');
      expect(rutas).not.toContain('antecedentesHeredofamiliares');
      expect(body.referenciaAntecedentes).toMatchObject({
        noteId: gral.noteId,
        especialidad: 'general',
        antecedentesHeredofamiliares: '<p>Madre con DM2</p>',
      });
      expect(body.pendientes).toEqual(
        expect.arrayContaining([{ codigo: 'CAMPO_REQUERIDO', ruta: 'verificacionAntecedentes' }]),
      );

      // El autosave devuelve el esquema y los pendientes recalculados.
      const guardado = await request(app.getHttpServer())
        .put(`/api/consultations/${citaId}/note`)
        .set(auth(cardio))
        .send({
          contenido: {
            ...body.contenido,
            verificacionAntecedentes: { estado: 'no_fue_posible_verificar' },
          },
        })
        .expect(200);
      expect(guardado.body.pendientes).toEqual(
        expect.arrayContaining([{ codigo: 'MOTIVO_REQUERIDO', ruta: 'verificacionAntecedentes' }]),
      );
      expect(JSON.stringify(guardado.body.pendientes)).not.toContain('DM2');
    });

    it('con el catálogo v1 en borrador, una nota v1 no expone reglas, campos, bloques ni motivos del borrador', async () => {
      await flag('cardiologia', true);
      const { citaId } = await abrir(cardio, await nuevoPaciente());
      const { body } = await request(app.getHttpServer())
        .get(`/api/consultations/${citaId}/note`)
        .set(auth(cardio))
        .expect(200);
      expect(body.esquema.plantillaVersion).toBe('v1');
      const rutas: string[] = body.esquema.campos.map((c: { ruta: string }) => c.ruta);
      expect(rutas.some((r) => r.startsWith('bloques.'))).toBe(false);
      expect(rutas).not.toContain('extension.car_antecedente_cv');
      expect(rutas).toContain('extension.car_ecg'); // campo base que el borrador retiraría
      expect(body.esquema.campos.some((c: { reglaId?: string }) => c.reglaId?.startsWith('v1.'))).toBe(false);

      const res = await request(app.getHttpServer())
        .put(`/api/consultations/${citaId}/note`)
        .set(auth(cardio))
        .send({ contenido: { ...body.contenido, motivoConsulta: 'dolor_toracico' } })
        .expect(422);
      expect(res.body).toMatchObject({ error: 'EstructuraNotaInvalida', rutas: ['motivoConsulta'] });
    });

    it('una nota legacy recibe su esquema legacy, sin referencia', async () => {
      await flag('nutricion', false);
      const { citaId } = await abrir(nutri, await nuevoPaciente());
      const { body } = await request(app.getHttpServer())
        .get(`/api/consultations/${citaId}/note`)
        .set(auth(nutri))
        .expect(200);
      expect(body.esquema.plantillaVersion).toBe('legacy-v0');
      expect(body.referenciaAntecedentes).toBeNull();
      expect(body.pendientes.map((p: { ruta: string }) => p.ruta)).toEqual(
        expect.arrayContaining(['padecimientoActual', 'antecedentesHeredofamiliares']),
      );
    });
  });

  describe('nunca se confía en el cliente', () => {
    it('el autosave no cambia contexto, plantilla, especialidad ni tipo', async () => {
      await flag('cardiologia', true);
      const { citaId, noteId, fila: antes } = await abrir(cardio, await nuevoPaciente());
      await request(app.getHttpServer())
        .put(`/api/consultations/${citaId}/note`)
        .set(auth(cardio))
        .send({
          contenido: {
            ...EMPTY_HISTORIA_CLINICA,
            tipoNota: 'nota_evolucion',
            especialidad: 'nutricion',
            contextoNota: 'seguimiento',
            plantillaVersion: 'legacy-v0',
          },
        })
        .expect(200);
      expect(await fila(noteId)).toEqual(antes);

      const { body } = await request(app.getHttpServer())
        .get(`/api/consultations/${citaId}/note`)
        .set(auth(cardio))
        .expect(200);
      expect(body.contenido).toMatchObject({
        tipoNota: 'historia_clinica',
        especialidad: 'cardiologia',
        contextoNota: 'general',
        plantillaVersion: 'v1',
      });
    });

    it('SQL directo con el rol de aplicación no puede cambiar el sello de un borrador v1', async () => {
      const { noteId } = await abrir(cardio, await nuevoPaciente());
      for (const cambio of [
        sql`contexto_nota = 'seguimiento'`,
        sql`especialidad = 'nutricion'`,
        sql`plantilla_version = 'legacy-v0'`,
        sql`tipo_nota = 'nota_evolucion'`,
      ]) {
        await expect(
          runInTenant(appDb.db, tenantId, (tx) =>
            tx.execute(sql`UPDATE clinical_notes SET ${cambio} WHERE id = ${noteId}`),
          ),
        ).rejects.toThrow(/no se pueden cambiar/);
      }
    });

    it('una nota legacy no puede subirse a v1 después de creada', async () => {
      await flag('nutricion', false);
      const { noteId } = await abrir(nutri, await nuevoPaciente());
      await expect(
        runInTenant(appDb.db, tenantId, (tx) =>
          tx.execute(sql`
            UPDATE clinical_notes
               SET plantilla_version = 'v1', especialidad = 'nutricion', contexto_nota = 'general'
             WHERE id = ${noteId}
          `),
        ),
      ).rejects.toThrow(/sin plantilla versionada/);
    });

    it('la aplicación no puede encenderse el flag a sí misma', async () => {
      await expect(
        runInTenant(appDb.db, tenantId, (tx) =>
          tx.execute(sql`INSERT INTO notas_v2_rollout (especialidad, habilitado) VALUES ('psiquiatria', true)`),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        runInTenant(appDb.db, tenantId, (tx) =>
          tx.execute(sql`UPDATE notas_v2_rollout SET habilitado = true`),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it('la auditoría de apertura registra la plantilla sin contenido clínico', async () => {
      const { noteId } = await abrir(cardio, await nuevoPaciente());
      const res = await admin.db.execute(sql`
        SELECT detalle FROM audit_log
         WHERE tenant_id = ${tenantId}::uuid AND entidad_id = ${noteId}::uuid AND accion = 'open_consultation'
      `);
      expect((res.rows[0] as { detalle: Record<string, unknown> }).detalle).toMatchObject({
        plantillaVersion: 'v1',
        contextoNota: 'general',
      });
    });
  });
});
