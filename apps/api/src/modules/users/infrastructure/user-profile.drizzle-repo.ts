import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { UserProfile } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import type {
  PerfilPersistido,
  UpdatePerfilInput,
  UserProfileRepository,
} from '../domain/user-profile.repository';

interface UserProfileRow {
  id: string;
  nombre: string;
  rol: UserProfile['rol'];
  especialidad: string | null;
  especialidad_key: UserProfile['especialidadKey'];
  cedula_profesional: string | null;
  cedula_especialidad: string | null;
  institucion_titulo: string | null;
}

function toProfile(row: UserProfileRow): PerfilPersistido {
  return {
    id: row.id,
    nombre: row.nombre,
    rol: row.rol,
    especialidad: row.especialidad,
    especialidadKey: row.especialidad_key,
    cedulaProfesional: row.cedula_profesional,
    cedulaEspecialidad: row.cedula_especialidad,
    institucionTitulo: row.institucion_titulo,
  };
}

/**
 * Adaptador Drizzle/Postgres del puerto UserProfileRepository. Corre sobre la
 * transacción con tenant fijado: RLS aísla las lecturas y el UPDATE a
 * cualquier usuario de otra clínica.
 */
@Injectable()
export class DrizzleUserProfileRepository implements UserProfileRepository {
  async getById(tx: Tx, userId: string): Promise<PerfilPersistido | null> {
    const result = await tx.execute(sql`
      SELECT id, nombre, rol, especialidad, especialidad_key,
             cedula_profesional, cedula_especialidad, institucion_titulo
        FROM users
       WHERE id = ${userId}
       LIMIT 1
    `);
    const row = (result.rows as unknown as UserProfileRow[])[0];
    return row ? toProfile(row) : null;
  }

  async updatePerfil(
    tx: Tx,
    userId: string,
    input: UpdatePerfilInput,
  ): Promise<PerfilPersistido | null> {
    const result = await tx.execute(sql`
      UPDATE users
         SET especialidad = ${input.especialidad},
             especialidad_key = ${input.especialidadKey},
             cedula_profesional = ${input.cedulaProfesional},
             cedula_especialidad = ${input.cedulaEspecialidad},
             institucion_titulo = ${input.institucionTitulo}
       WHERE id = ${userId}
      RETURNING id, nombre, rol, especialidad, especialidad_key,
                cedula_profesional, cedula_especialidad, institucion_titulo
    `);
    const row = (result.rows as unknown as UserProfileRow[])[0];
    return row ? toProfile(row) : null;
  }

  async getPasswordHash(tx: Tx, userId: string): Promise<string | null> {
    const result = await tx.execute(sql`
      SELECT password_hash FROM users WHERE id = ${userId} LIMIT 1
    `);
    const row = (result.rows as unknown as { password_hash: string }[])[0];
    return row?.password_hash ?? null;
  }

  async updatePasswordHash(tx: Tx, userId: string, newHash: string): Promise<boolean> {
    const result = await tx.execute(sql`
      UPDATE users SET password_hash = ${newHash} WHERE id = ${userId} RETURNING id
    `);
    return result.rows.length > 0;
  }
}
