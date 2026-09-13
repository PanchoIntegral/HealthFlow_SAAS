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
import { DrizzleClinicalRecordRepository } from '../src/modules/clinical-records/infrastructure/clinical-record.drizzle-repo';

loadDotEnv();

/**
 * Una nota clínica cerrada es inmutable (NOM-004) — y no sólo en el dominio.
 *
 * Lo que se prueba aquí necesita PostgreSQL real: el UPDATE condicionado que
 * impide que un autosave reabra una nota firmada, el trigger 0052 frente al
 * rol de aplicación, y la firma que ya no se estampa con un autor genérico.
 *
 * Requiere `pnpm db:setup && pnpm db:migrate` previos.
 */
describe('Notas clínicas cerradas inmutables', () => {
  const admin = createAdminDb();
  const appDb = createAppDb();
  const repo = new DrizzleClinicalRecordRepository();
  let app: INestApplication;

  const tenantId = randomUUID();
  const medico = randomUUID();
  const medicoSinCedula = randomUUID();
  const paciente = randomUUID();
  let tokenMedico: string;
  let tokenSinCedula: string;

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  /** Agenda, hace check-in e inicia consulta: deja una nota borrador. */
  async function abrirConsulta(token: string, doctorId: string, offsetMin: number) {
    const inicio = new Date(Date.now() + offsetMin * 60_000);
    const fin = new Date(inicio.getTime() + 20 * 60_000);
    const { body: cita } = await request(app.getHttpServer())
      .post('/api/appointments')
      .set(auth(token))
      .send({
        patientId: paciente,
        doctorId,
        inicioProgramado: inicio.toISOString(),
        finProgramado: fin.toISOString(),
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/appointments/${cita.id}/check-in`)
      .set(auth(token))
      .expect(201);
    const { body: inicioConsulta } = await request(app.getHttpServer())
      .post(`/api/appointments/${cita.id}/start-consultation`)
      .set(auth(token))
      .expect(201);
    return { citaId: cita.id as string, noteId: inicioConsulta.noteId as string };
  }

  /** Contenido que cumple la base NOM-004 de una historia clínica 'general'. */
  function completa(): NotaEvolucionContent {
    return {
      ...EMPTY_HISTORIA_CLINICA,
      padecimientoActual: '<p>Cefalea de tres días.</p>',
      exploracionFisica: {
        signosVitales: { ...EMPTY_HISTORIA_CLINICA.exploracionFisica.signosVitales, ta: '120/80' },
        hallazgos: '',
      },
      diagnosticos: [{ cie10: 'R51', descripcion: 'Cefalea' }],
      planTerapeutico: '<p>Reposo e hidratación.</p>',
      antecedentesHeredofamiliares: '<p>Negados.</p>',
      antecedentesPersonalesPatologicos: '<p>Negados.</p>',
      antecedentesPersonalesNoPatologicos: '<p>Sin tabaquismo.</p>',
    };
  }

  beforeAll(async () => {
    await admin.db.execute(sql`
      INSERT INTO tenants (id, nombre_clinica, plan, subscription_status)
      VALUES (${tenantId}::uuid, 'Clínica Notas Inmutables', 'consultorio', 'active')
    `);
    await admin.db.execute(sql`
      INSERT INTO users (id, tenant_id, email, password_hash, nombre, rol, es_medico, cedula_profesional)
      VALUES (${medico}::uuid, ${tenantId}::uuid, ${`${medico}@test.mx`}, 'x', 'Dra. Firma', 'admin', true, '1234567'),
             (${medicoSinCedula}::uuid, ${tenantId}::uuid, ${`${medicoSinCedula}@test.mx`}, 'x', 'Dr. Sin Cédula', 'admin', true, NULL)
    `);
    await admin.db.execute(sql`
      INSERT INTO patients (id, tenant_id, nombre, fecha_nacimiento)
      VALUES (${paciente}::uuid, ${tenantId}::uuid, 'Paciente Inmutable', '1990-01-01')
    `);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();

    const jwt = app.get(JwtService);
    tokenMedico = jwt.sign({ sub: medico, tid: tenantId, rol: 'admin' }, { secret: env.jwtSecret });
    tokenSinCedula = jwt.sign(
      { sub: medicoSinCedula, tid: tenantId, rol: 'admin' },
      { secret: env.jwtSecret },
    );
  });

  afterAll(async () => {
    // Como admin: el trigger sólo impide borrar notas cerradas a los roles de la app.
    for (const tabla of [
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
      await admin.db.execute(
        sql`DELETE FROM ${sql.identifier(tabla)} WHERE tenant_id = ${tenantId}::uuid`,
      );
    }
    await admin.db.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`);
    await app?.close();
    await admin.pool.end();
    await appDb.pool.end();
  });

  describe('firma', () => {
    it('rechaza el cierre de quien no tiene cédula, sin cerrar la nota', async () => {
      const { citaId, noteId } = await abrirConsulta(tokenSinCedula, medicoSinCedula, 30);
      const res = await request(app.getHttpServer())
        .post(`/api/consultations/${citaId}/finish`)
        .set(auth(tokenSinCedula))
        .send({ contenido: completa() })
        .expect(422);
      expect(res.body.error).toBe('FirmaIncompleta');

      const estatus = await runInTenant(appDb.db, tenantId, (tx) =>
        tx.execute(sql`SELECT estatus FROM clinical_notes WHERE id = ${noteId}`),
      );
      expect(estatus.rows[0]).toEqual({ estatus: 'borrador' });
    });

    it('rechaza que un médico firme la nota de otro', async () => {
      const { citaId } = await abrirConsulta(tokenMedico, medico, 90);
      const res = await request(app.getHttpServer())
        .post(`/api/consultations/${citaId}/finish`)
        .set(auth(tokenSinCedula))
        .send({ contenido: completa() })
        .expect(403);
      expect(res.body.error).toBe('NotaDeOtroMedico');
    });
  });

  describe('nota cerrada', () => {
    let citaId: string;
    let noteId: string;

    beforeAll(async () => {
      ({ citaId, noteId } = await abrirConsulta(tokenMedico, medico, 150));
      await request(app.getHttpServer())
        .post(`/api/consultations/${citaId}/finish`)
        .set(auth(tokenMedico))
        .send({ contenido: completa() })
        .expect(201);
    });

    it('estampa la firma real del médico', async () => {
      const { body } = await request(app.getHttpServer())
        .get(`/api/consultations/${citaId}/note`)
        .set(auth(tokenMedico))
        .expect(200);
      expect(body.estatus).toBe('cerrada');
      expect(body.contenido.firma).toMatchObject({ medicoNombre: 'Dra. Firma', cedula: '1234567' });
    });

    it('el autosave posterior al cierre responde 409', async () => {
      await request(app.getHttpServer())
        .put(`/api/consultations/${citaId}/note`)
        .set(auth(tokenMedico))
        .send({ contenido: { ...completa(), planTerapeutico: '<p>Otro plan</p>' } })
        .expect(409);
    });

    it('el rol de aplicación no puede modificarla con SQL directo', async () => {
      await expect(
        runInTenant(appDb.db, tenantId, (tx) =>
          tx.execute(sql`
            UPDATE clinical_notes SET contenido_nom004 = '{}'::jsonb WHERE id = ${noteId}
          `),
        ),
      ).rejects.toThrow(/cerrada y es inmutable/);

      await expect(
        runInTenant(appDb.db, tenantId, (tx) =>
          tx.execute(sql`UPDATE clinical_notes SET estatus = 'borrador' WHERE id = ${noteId}`),
        ),
      ).rejects.toThrow(/cerrada y es inmutable/);
    });

    it('el rol de aplicación no puede borrarla, desactivar el trigger ni truncar', async () => {
      await expect(
        runInTenant(appDb.db, tenantId, (tx) =>
          tx.execute(sql`DELETE FROM clinical_notes WHERE id = ${noteId}`),
        ),
      ).rejects.toThrow(/no puede eliminarse/);

      await expect(
        runInTenant(appDb.db, tenantId, (tx) =>
          tx.execute(sql`ALTER TABLE clinical_notes DISABLE TRIGGER clinical_notes_inmutable`),
        ),
      ).rejects.toThrow(/must be owner/);

      await expect(
        runInTenant(appDb.db, tenantId, (tx) => tx.execute(sql`TRUNCATE clinical_notes`)),
      ).rejects.toThrow(/permission denied/);
    });

    it('la corrección se agrega como adenda, sin tocar la nota', async () => {
      const antes = await runInTenant(appDb.db, tenantId, (tx) =>
        tx.execute(sql`SELECT contenido_nom004 FROM clinical_notes WHERE id = ${noteId}`),
      );
      await request(app.getHttpServer())
        .post(`/api/notas/${noteId}/correcciones`)
        .set(auth(tokenMedico))
        .send({ texto: 'Se aclara que la cefalea es frontal.' })
        .expect(201);
      const despues = await runInTenant(appDb.db, tenantId, (tx) =>
        tx.execute(sql`SELECT contenido_nom004 FROM clinical_notes WHERE id = ${noteId}`),
      );
      expect(despues.rows).toEqual(antes.rows);
    });
  });

  describe('lo que el cliente no decide', () => {
    it('el autosave no cambia el tipo de nota ni guarda una firma', async () => {
      const { citaId, noteId } = await abrirConsulta(tokenMedico, medico, 270);
      await request(app.getHttpServer())
        .put(`/api/consultations/${citaId}/note`)
        .set(auth(tokenMedico))
        .send({
          contenido: {
            ...completa(),
            tipoNota: 'nota_evolucion',
            plantillaVersion: 'v1',
            firma: { medicoNombre: 'Falso', cedula: '1', fecha: '2026-01-01' },
          },
        })
        .expect(200);

      const fila = await runInTenant(appDb.db, tenantId, (tx) =>
        tx.execute(sql`
          SELECT tipo_nota,
                 contenido_nom004->>'tipoNota' AS tipo_contenido,
                 contenido_nom004 ? 'firma' AS con_firma,
                 contenido_nom004 ? 'plantillaVersion' AS con_plantilla
            FROM clinical_notes WHERE id = ${noteId}
        `),
      );
      // La consulta anterior de este paciente ya abrió su historia clínica,
      // así que ésta es evolución; lo que importa es que coincidan.
      const { tipo_nota, tipo_contenido, con_firma, con_plantilla } = fila.rows[0] as Record<string, unknown>;
      expect(tipo_contenido).toBe(tipo_nota);
      expect(con_firma).toBe(false);
      expect(con_plantilla).toBe(false);
    });

    it('rechaza contenido con forma inválida devolviendo sólo rutas', async () => {
      const { citaId } = await abrirConsulta(tokenMedico, medico, 330);
      const res = await request(app.getHttpServer())
        .put(`/api/consultations/${citaId}/note`)
        .set(auth(tokenMedico))
        .send({ contenido: { ...completa(), diagnosticos: [{ cie10: 7, descripcion: 'Dato clínico' }] } })
        .expect(422);
      expect(res.body.error).toBe('EstructuraNotaInvalida');
      expect(JSON.stringify(res.body)).not.toContain('Dato clínico');
    });
  });

  it('un autosave que leyó el borrador antes del cierre no lo reabre', async () => {
    const { citaId, noteId } = await abrirConsulta(tokenMedico, medico, 210);

    // El autosave "tardío" lee la nota todavía en borrador…
    const borrador = await runInTenant(appDb.db, tenantId, (tx) =>
      repo.findNoteByAppointment(tx, citaId),
    );
    expect(borrador?.estatus).toBe('borrador');
    borrador!.saveDraft({ ...completa(), planTerapeutico: '<p>Plan viejo</p>' });

    // …la nota se cierra mientras tanto…
    await request(app.getHttpServer())
      .post(`/api/consultations/${citaId}/finish`)
      .set(auth(tokenMedico))
      .send({ contenido: completa() })
      .expect(201);

    // …y su escritura ya no encuentra una nota en borrador que pisar.
    const escrito = await runInTenant(appDb.db, tenantId, (tx) =>
      repo.saveDraftContent(tx, borrador!),
    );
    expect(escrito).toBe(false);

    const fila = await runInTenant(appDb.db, tenantId, (tx) =>
      tx.execute(sql`
        SELECT estatus, contenido_nom004->>'planTerapeutico' AS plan
          FROM clinical_notes WHERE id = ${noteId}
      `),
    );
    expect(fila.rows[0]).toEqual({ estatus: 'cerrada', plan: '<p>Reposo e hidratación.</p>' });
  });
});
