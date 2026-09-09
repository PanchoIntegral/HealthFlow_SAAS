import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { loadDotEnv, env } from '../src/config/env';
import { createAdminDb } from '../src/db/drizzle';
import { AppModule } from '../src/app.module';
import { PLANES_CON_RESERVA } from '../src/modules/public-booking/booking.service';

loadDotEnv();

/**
 * El directorio es la única superficie del producto que cruza tenants a
 * propósito, y lo hace sin autenticación. Su corrección no puede probarse con
 * dobles: depende de `search_public_booking_directory`, una función
 * SECURITY DEFINER que ignora RLS por diseño. Esta suite la ejerce contra
 * Postgres real y fija las dos garantías que la hacen aceptable:
 *
 *   1. Aparecer requiere consentimiento explícito (`directorio_publico`), que
 *      es distinto de tener la página de reservas publicada.
 *   2. La respuesta sólo contiene lo que la clínica eligió publicar — jamás
 *      pacientes, citas ni contacto.
 */
describe('Directorio público de reservas', () => {
  const admin = createAdminDb();
  let app: INestApplication;

  const nombreVisible = `Directorio Visible ${randomUUID().slice(0, 8)}`;
  const nombreOculta = `Directorio Oculta ${randomUUID().slice(0, 8)}`;
  const slugVisible = `dir-visible-${randomUUID().slice(0, 8)}`;
  const slugOculta = `dir-oculta-${randomUUID().slice(0, 8)}`;
  const especialidad = `Neumología ${randomUUID().slice(0, 6)}`;

  let tenantVisible: string;
  let tenantOculta: string;
  let doctorVisible: string;
  let visitas = 0;

  const nombreIndividual = `Directorio Individual ${randomUUID().slice(0, 8)}`;
  const slugIndividual = `dir-individual-${randomUUID().slice(0, 8)}`;
  let tenantIndividual: string;
  // Especialidad propia: la del par visible/oculta mide el consentimiento y se
  // enturbiaría si una tercera clínica la compartiera.
  const especialidadIndividual = `Geriatría ${randomUUID().slice(0, 6)}`;

  /**
   * Crea una clínica lista para reservar en línea. `directorio` es lo único
   * que cambia entre las dos: así, cualquier diferencia en los resultados sólo
   * puede atribuirse al consentimiento.
   */
  async function crearClinica(nombre: string, slug: string, directorio: boolean, nombreDoctor: string, plan = 'consultorio', esp = especialidad) {
    const tenantId = randomUUID();
    const doctorId = randomUUID();
    const serviceId = randomUUID();

    await admin.db.execute(sql`
      INSERT INTO tenants (id, nombre_clinica, direccion, plan, subscription_status)
      VALUES (${tenantId}::uuid, ${nombre}, 'Calle Falsa 123', ${plan}, 'active')
    `);
    await admin.db.execute(sql`
      INSERT INTO users (id, tenant_id, email, password_hash, nombre, rol, es_medico, especialidad)
      VALUES (${doctorId}::uuid, ${tenantId}::uuid, ${`${doctorId}@test.mx`}, 'x', ${nombreDoctor}, 'admin', true, ${esp})
    `);
    await admin.db.execute(sql`
      INSERT INTO booking_settings (tenant_id, slug, publicado, feature_activa, directorio_publico)
      VALUES (${tenantId}::uuid, ${slug}, true, true, ${directorio})
    `);
    await admin.db.execute(sql`
      INSERT INTO booking_services (id, tenant_id, nombre, duracion_minutos, publico, activo)
      VALUES (${serviceId}::uuid, ${tenantId}::uuid, 'Consulta', 30, true, true)
    `);
    await admin.db.execute(sql`
      INSERT INTO booking_service_doctors (tenant_id, service_id, doctor_id)
      VALUES (${tenantId}::uuid, ${serviceId}::uuid, ${doctorId}::uuid)
    `);
    return { tenantId, doctorId };
  }

  beforeAll(async () => {
    ({ tenantId: tenantVisible, doctorId: doctorVisible } = await crearClinica(
      nombreVisible, slugVisible, true, 'Dra. Visible',
    ));
    ({ tenantId: tenantOculta } = await crearClinica(
      nombreOculta, slugOculta, false, 'Dr. Oculto',
    ));
    ({ tenantId: tenantIndividual } = await crearClinica(
      nombreIndividual, slugIndividual, true, 'Dra. Individual', 'individual', especialidadIndividual,
    ));

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    // El throttler cuenta por IP de cliente y esta suite hace más peticiones
    // por segundo que la ráfaga permitida. En vez de desactivar el guard —que
    // dejaría de ejercitarse— confiamos en el proxy para que `visitante()`
    // pueda darle a cada petición su propio cubo.
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
    await app.init();
  });

  /** Petición pública desde una IP nueva: no comparte cubo de rate limiting. */
  function visitante(path: string) {
    return request(app.getHttpServer())
      .get(path)
      .set('X-Forwarded-For', `203.0.113.${++visitas % 254 + 1}`);
  }

  afterAll(async () => {
    await app?.close();
    for (const tenantId of [tenantVisible, tenantOculta, tenantIndividual]) {
      if (tenantId) await admin.db.execute(sql`DELETE FROM tenants WHERE id = ${tenantId}::uuid`);
    }
    await admin.pool.end();
  });

  it('lista sin autenticación a la clínica que dio su consentimiento', async () => {
    const { body } = await visitante('/api/public/directory')
      .query({ pageSize: 24 })
      .expect(200);

    const slugs = body.items.map((x: { slug: string }) => x.slug);
    expect(slugs).toContain(slugVisible);
  });

  it('excluye a la clínica publicada que NO optó por el directorio', async () => {
    const { body } = await visitante('/api/public/directory')
      .query({ q: nombreOculta, pageSize: 24 })
      .expect(200);

    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('busca por nombre de clínica, de profesional y por especialidad', async () => {
    for (const q of [nombreVisible, 'Dra. Visible', especialidad]) {
      const { body } = await visitante('/api/public/directory')
        .query({ q, pageSize: 24 })
        .expect(200);
      expect(body.items.map((x: { slug: string }) => x.slug)).toContain(slugVisible);
    }
  });

  it('el filtro de especialidad exige coincidencia exacta, no parcial', async () => {
    const exacta = await visitante('/api/public/directory')
      .query({ specialty: especialidad, pageSize: 24 })
      .expect(200);
    expect(exacta.body.items.map((x: { slug: string }) => x.slug)).toContain(slugVisible);

    // 'Neumo' aparece dentro de la especialidad, pero no es la especialidad:
    // un chip del filtro siempre manda el valor completo.
    const parcial = await visitante('/api/public/directory')
      .query({ specialty: 'Neumo', pageSize: 24 })
      .expect(200);
    expect(parcial.body.items.map((x: { slug: string }) => x.slug)).not.toContain(slugVisible);
  });

  it('el catálogo de especialidades sólo refleja clínicas con consentimiento', async () => {
    const { body } = await visitante('/api/public/directory/specialties')
      .expect(200);

    const entrada = body.find((x: { specialty: string }) => x.specialty === especialidad);
    // Ambas clínicas comparten especialidad; sólo debe contarse la visible.
    expect(entrada).toEqual({ specialty: especialidad, total: 1 });
  });

  it('no expone más que el perfil que la clínica eligió publicar', async () => {
    const { body } = await visitante('/api/public/directory')
      .query({ q: nombreVisible, pageSize: 24 })
      .expect(200);

    const item = body.items.find((x: { doctorId: string }) => x.doctorId === doctorVisible);
    expect(Object.keys(item).sort()).toEqual(
      ['clinicAddress', 'clinicName', 'doctorId', 'doctorName', 'slug', 'specialty'].sort(),
    );
    // Ni el correo del médico ni el identificador del tenant cruzan la frontera.
    expect(JSON.stringify(body)).not.toContain(tenantVisible);
    expect(JSON.stringify(body)).not.toContain('@test.mx');
  });

  describe('el consentimiento se administra desde Ajustes → Reservas', () => {
    /** Payload que manda la pantalla de ajustes, con el opt-in parametrizado. */
    function ajustes(directorioPublico: boolean) {
      return {
        slug: slugVisible,
        publicado: true,
        directorioPublico,
        featureActiva: true,
        timezone: 'America/Tijuana',
        anticipacionMinimaHoras: 4,
        horizonteDias: 60,
        limiteCancelacionHoras: 4,
        recordatoriosHoras: [48, 24],
        avisoPrivacidadVersion: '2026-01',
      };
    }

    function guardar(body: Record<string, unknown>) {
      const token = app
        .get(JwtService)
        .sign({ sub: doctorVisible, tid: tenantVisible, rol: 'admin' }, { secret: env.jwtSecret });
      return request(app.getHttpServer())
        .put('/api/booking/settings')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Forwarded-For', `198.51.100.${++visitas % 254 + 1}`)
        .send(body);
    }

    /**
     * Regresión: `recordatoriosHoras` viajaba como arreglo de JS dentro del
     * template `sql`, que drizzle expande a una lista de parámetros. Postgres
     * la leía como `record` contra una columna `integer[]` y respondía 500, así
     * que NINGUNA clínica podía guardar sus ajustes — ni activar el directorio.
     */
    it('guarda los ajustes con la lista de recordatorios', async () => {
      const { body } = await guardar(ajustes(true)).expect(200);
      expect(body.recordatoriosHoras).toEqual([48, 24]);
      expect(body.directorioPublico).toBe(true);
    });

    it('apagar el opt-in retira la clínica del directorio, y encenderlo la devuelve', async () => {
      await guardar(ajustes(false)).expect(200);
      const apagada = await visitante('/api/public/directory').query({ pageSize: 24 }).expect(200);
      expect(apagada.body.items.map((x: { slug: string }) => x.slug)).not.toContain(slugVisible);

      await guardar(ajustes(true)).expect(200);
      const encendida = await visitante('/api/public/directory').query({ pageSize: 24 }).expect(200);
      expect(encendida.body.items.map((x: { slug: string }) => x.slug)).toContain(slugVisible);
    });

    it('rechaza recordatorios que no sean enteros en vez de llevarlos al SQL', async () => {
      await guardar({ ...ajustes(true), recordatoriosHoras: ['1); DROP TABLE users; --'] }).expect(400);
    });
  });

  describe('planes admitidos', () => {
    /**
     * La reserva pública fue exclusiva del plan Consultorio hasta 0041. La
     * decisión de producto es que cualquier plan de pago pueda publicar, así
     * que una clínica en plan Individual debe ser tan visible como las demás.
     */
    it('una clínica en plan Individual aparece en el directorio', async () => {
      const { body } = await visitante('/api/public/directory')
        .query({ q: nombreIndividual, pageSize: 24 })
        .expect(200);
      expect(body.items.map((x: { slug: string }) => x.slug)).toContain(slugIndividual);
    });

    /**
     * Aparecer en el buscador sin poder reservar sería peor que no aparecer:
     * el filtro de plan vive en dos funciones SQL distintas y deben coincidir.
     */
    it('y su página de reservas resuelve, no da 404', async () => {
      await visitante(`/api/public/booking/${slugIndividual}`).expect(200);
    });

    /**
     * `PLANES_CON_RESERVA` sólo alimenta el diagnóstico de Ajustes, pero si se
     * separa de la función SQL la pantalla mentiría sobre por qué una clínica
     * no aparece. Esa lista ya había divergido de los planes reales una vez.
     */
    it('el diagnóstico de Ajustes usa la misma lista de planes que el SQL', async () => {
      const { rows } = await admin.db.execute(sql`SELECT public_booking_plans() AS planes`);
      expect((rows[0] as { planes: string[] }).planes.sort()).toEqual([...PLANES_CON_RESERVA].sort());
    });
  });

  it('acota el tamaño de página en lugar de confiar en el cliente', async () => {
    await visitante('/api/public/directory')
      .query({ pageSize: 500 })
      .expect(400);

    const { body } = await visitante('/api/public/directory')
      .query({ pageSize: 24, page: 1 })
      .expect(200);
    expect(body.pageSize).toBe(24);
  });
});
