import { createHmac, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import type { Page } from '@playwright/test';
import { API_URL, cargarEnv } from './entorno';

cargarEnv();

/**
 * Datos de prueba: una clínica desechable por archivo, creada con el rol
 * ADMIN (como los tests de integración) y recorrida con la API real.
 */

export interface Medico {
  id: string;
  nombre: string;
  token: string;
}

export class Clinica {
  readonly tenantId = randomUUID();
  private offsetMin = 0;
  private constructor(private readonly db: Client) {}

  static async crear(nombre: string): Promise<Clinica> {
    const db = new Client({ connectionString: process.env.DB_ADMIN_URL });
    await db.connect();
    const clinica = new Clinica(db);
    await db.query(
      `INSERT INTO tenants (id, nombre_clinica, plan, subscription_status) VALUES ($1, $2, 'consultorio', 'active')`,
      [clinica.tenantId, `${nombre} ${clinica.tenantId.slice(0, 8)}`],
    );
    return clinica;
  }

  async medico(nombre: string, especialidad: string): Promise<Medico> {
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO users (id, tenant_id, email, password_hash, nombre, rol, es_medico, cedula_profesional, especialidad_key)
       VALUES ($1, $2, $3, 'x', $4, 'admin', true, '1234567', $5)`,
      [id, this.tenantId, `e2e-${id}@test.mx`, nombre, especialidad],
    );
    return { id, nombre, token: firmarJwt({ sub: id, tid: this.tenantId, rol: 'admin' }) };
  }

  async paciente(nombre = 'Paciente E2E'): Promise<string> {
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO patients (id, tenant_id, nombre, fecha_nacimiento) VALUES ($1, $2, $3, '1968-05-10')`,
      [id, this.tenantId, nombre],
    );
    return id;
  }

  /** Sin fila = apagado; así se prueba el valor por defecto. */
  async notasV2(especialidad: string, habilitado: boolean): Promise<void> {
    await this.db.query(
      `INSERT INTO notas_v2_rollout (tenant_id, especialidad, habilitado, nota) VALUES ($1, $2, $3, 'e2e')
       ON CONFLICT (tenant_id, especialidad) DO UPDATE SET habilitado = EXCLUDED.habilitado`,
      [this.tenantId, especialidad, habilitado],
    );
  }

  /** Agenda, hace check-in e inicia consulta por la API. */
  async abrirConsulta(medico: Medico, patientId: string): Promise<string> {
    this.offsetMin += 30;
    const inicio = new Date(Date.now() + this.offsetMin * 60_000);
    const cita = await api<{ id: string }>(medico, 'POST', '/appointments', {
      patientId,
      doctorId: medico.id,
      inicioProgramado: inicio.toISOString(),
      finProgramado: new Date(inicio.getTime() + 20 * 60_000).toISOString(),
    });
    await api(medico, 'POST', `/appointments/${cita.id}/check-in`);
    await api(medico, 'POST', `/appointments/${cita.id}/start-consultation`);
    return cita.id;
  }

  /** Firma una historia clínica general completa, para preparar el expediente. */
  async firmarHistoriaGeneral(medico: Medico, patientId: string): Promise<void> {
    const citaId = await this.abrirConsulta(medico, patientId);
    const vitales = { ta: '120/80', fc: null, fr: null, temp: null, spo2: null, peso: null, talla: null };
    await api(medico, 'POST', `/consultations/${citaId}/finish`, {
      contenido: {
        tipoNota: 'historia_clinica',
        padecimientoActual: '<p>Chequeo anual</p>',
        exploracionFisica: { signosVitales: vitales, hallazgos: '' },
        diagnosticos: [{ cie10: 'Z00.0', descripcion: 'Examen médico general' }],
        planTerapeutico: 'Control anual',
        antecedentesHeredofamiliares: 'Madre con diabetes tipo 2',
        antecedentesPersonalesPatologicos: 'Apendicectomía en 2010',
        antecedentesPersonalesNoPatologicos: 'No fuma',
      },
    });
  }

  async nota(citaId: string): Promise<{ estatus: string; contexto_nota: string | null; plantilla_version: string | null; contenido: Record<string, unknown> }> {
    const { rows } = await this.db.query(
      `SELECT estatus, contexto_nota, plantilla_version, contenido_nom004 AS contenido
         FROM clinical_notes WHERE appointment_id = $1`,
      [citaId],
    );
    return rows[0];
  }

  async borrar(): Promise<void> {
    for (const tabla of [
      'notas_v2_rollout',
      'notas_correccion',
      'recetas',
      'clinical_notes',
      'clinical_records',
      'app_events',
      'appointments',
      'notifications',
      'audit_log',
      'patients',
      'users',
    ]) {
      await this.db.query(`DELETE FROM ${tabla} WHERE tenant_id = $1`, [this.tenantId]).catch(() => undefined);
    }
    await this.db.query('DELETE FROM tenants WHERE id = $1', [this.tenantId]);
    await this.db.end();
  }
}

/** Abre la consulta en el navegador con la sesión del médico ya puesta. */
export async function abrirEditor(page: Page, medico: Medico, citaId: string, patientId: string): Promise<void> {
  const tenantId = JSON.parse(Buffer.from(medico.token.split('.')[1]!, 'base64url').toString()).tid;
  await page.addInitScript(
    ([sesion]) => localStorage.setItem('healthflow.session', sesion as string),
    [
      JSON.stringify({
        accessToken: medico.token,
        user: { id: medico.id, tenantId, nombre: medico.nombre, rol: 'admin' },
      }),
    ],
  );
  await page.goto(`/consulta/${citaId}?patientId=${patientId}`);
}

async function api<T = unknown>(medico: Medico, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${medico.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  const texto = await res.text();
  return (texto ? JSON.parse(texto) : undefined) as T;
}

/**
 * JWT HS256 firmado con el mismo secreto que el API. Evita pasar por el login
 * (que no es lo que se prueba y tiene rate limit estricto).
 */
function firmarJwt(payload: Record<string, unknown>): string {
  const secreto = process.env.JWT_SECRET;
  if (!secreto) throw new Error('Falta JWT_SECRET para las pruebas E2E');
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const ahora = Math.floor(Date.now() / 1000);
  const cuerpo = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ ...payload, iat: ahora, exp: ahora + 3600 })}`;
  return `${cuerpo}.${createHmac('sha256', secreto).update(cuerpo).digest('base64url')}`;
}
