import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { CuentaView, EspecialidadKey, UserRole } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import type {
  ConteoCuentas,
  CuentasRepository,
  NuevaCuenta,
} from '../domain/cuentas.repository';

interface CuentaRow {
  id: string;
  nombre: string;
  email: string;
  rol: UserRole;
  es_medico: boolean;
  especialidad: string | null;
  especialidad_key: EspecialidadKey;
  cedula_profesional: string | null;
  activo: boolean;
  medico_titular_id: string | null;
  medico_titular_nombre: string | null;
  created_at: Date | string;
}

function toView(row: CuentaRow): CuentaView {
  return {
    id: row.id,
    nombre: row.nombre,
    email: row.email,
    rol: row.rol,
    esMedico: row.es_medico,
    especialidad: row.especialidad,
    especialidadKey: row.especialidad_key,
    cedulaProfesional: row.cedula_profesional,
    activo: row.activo,
    medicoTitularId: row.medico_titular_id,
    medicoTitularNombre: row.medico_titular_nombre,
    // El dueño de la suscripción es el único 'admin' del tenant (lo crea el
    // webhook de Stripe o create-account.ts, nunca esta pantalla).
    esTitular: row.rol === 'admin',
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** Columnas de la vista, con el nombre del médico al que asiste (si aplica). */
const SELECT_CUENTA = sql`
  SELECT u.id, u.nombre, u.email, u.rol, u.es_medico, u.especialidad, u.especialidad_key,
         u.cedula_profesional, u.activo, u.medico_titular_id, m.nombre AS medico_titular_nombre,
         u.created_at
    FROM users u
    LEFT JOIN users m ON m.id = u.medico_titular_id
`;

@Injectable()
export class DrizzleCuentasRepository implements CuentasRepository {
  async list(tx: Tx): Promise<CuentaView[]> {
    const result = await tx.execute(sql`
      ${SELECT_CUENTA}
      -- El titular primero, luego el resto por nombre: la lista se lee como
      -- está organizado el consultorio, no en orden de alta.
      ORDER BY (u.rol = 'admin') DESC, u.nombre ASC
    `);
    return (result.rows as unknown as CuentaRow[]).map(toView);
  }

  async contarActivas(tx: Tx): Promise<ConteoCuentas> {
    const result = await tx.execute(sql`
      SELECT
        count(*) FILTER (WHERE rol = 'medico' OR es_medico) AS medicos,
        count(*) FILTER (WHERE rol = 'asistente')           AS asistentes
        FROM users
       WHERE activo
    `);
    const row = (result.rows as unknown as { medicos: string; asistentes: string }[])[0];
    return {
      medicos: Number(row?.medicos ?? 0),
      asistentes: Number(row?.asistentes ?? 0),
    };
  }

  async existeEmail(tx: Tx, email: string): Promise<boolean> {
    // Incluye las cuentas desactivadas a propósito: la restricción UNIQUE
    // (tenant_id, email) sigue viva para ellas, así que insertar reventaría.
    const result = await tx.execute(sql`
      SELECT 1 FROM users WHERE lower(email) = lower(${email}) LIMIT 1
    `);
    return result.rows.length > 0;
  }

  async create(tx: Tx, cuenta: NuevaCuenta): Promise<CuentaView> {
    const result = await tx.execute(sql`
      INSERT INTO users (email, password_hash, nombre, rol, es_medico, cedula_profesional,
                         especialidad, especialidad_key, creado_por, medico_titular_id)
      VALUES (${cuenta.email}, ${cuenta.passwordHash}, ${cuenta.nombre}, ${cuenta.rol},
              ${cuenta.esMedico}, ${cuenta.cedulaProfesional}, ${cuenta.especialidad},
              ${cuenta.especialidadKey}, ${cuenta.creadoPor}, ${cuenta.medicoTitularId})
      RETURNING id
    `);
    // tenant_id no se pasa: lo pone el DEFAULT current_tenant_id() de la
    // columna a partir del tenant fijado en la transacción (ver 0018).
    //
    // Se relee con getById en vez de aprovechar el RETURNING: la vista incluye
    // el nombre del médico al que asiste, que sale de un JOIN y el RETURNING
    // no puede dar. Devolver esa columna en null obligaría a la UI a recargar
    // para pintar bien una fila que acaba de crear.
    const id = (result.rows as unknown as { id: string }[])[0]!.id;
    return (await this.getById(tx, id))!;
  }

  async getById(tx: Tx, id: string): Promise<CuentaView | null> {
    const result = await tx.execute(sql`${SELECT_CUENTA} WHERE u.id = ${id} LIMIT 1`);
    const row = (result.rows as unknown as CuentaRow[])[0];
    return row ? toView(row) : null;
  }

  async esMedicoActivo(tx: Tx, id: string): Promise<boolean> {
    const result = await tx.execute(sql`
      SELECT 1 FROM users
       WHERE id = ${id} AND activo AND (rol = 'medico' OR es_medico)
       LIMIT 1
    `);
    return result.rows.length > 0;
  }

  async setActivo(tx: Tx, id: string, activo: boolean): Promise<CuentaView | null> {
    const result = await tx.execute(sql`
      UPDATE users SET activo = ${activo} WHERE id = ${id} RETURNING id
    `);
    if (result.rows.length === 0) return null;
    return this.getById(tx, id);
  }
}
