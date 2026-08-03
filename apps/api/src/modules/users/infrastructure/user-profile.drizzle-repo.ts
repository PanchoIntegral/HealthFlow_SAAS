import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { UserProfile } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';
import type { UpdateEspecialidadInput, UserProfileRepository } from '../domain/user-profile.repository';

interface UserProfileRow {
  id: string;
  nombre: string;
  rol: UserProfile['rol'];
  especialidad: string | null;
  especialidad_key: UserProfile['especialidadKey'];
}

function toProfile(row: UserProfileRow): UserProfile {
  return {
    id: row.id,
    nombre: row.nombre,
    rol: row.rol,
    especialidad: row.especialidad,
    especialidadKey: row.especialidad_key,
  };
}

/**
 * Adaptador Drizzle/Postgres del puerto UserProfileRepository. Corre sobre la
 * transacción con tenant fijado: RLS aísla las lecturas y el UPDATE a
 * cualquier usuario de otra clínica.
 */
@Injectable()
export class DrizzleUserProfileRepository implements UserProfileRepository {
  async getById(tx: Tx, userId: string): Promise<UserProfile | null> {
    const result = await tx.execute(sql`
      SELECT id, nombre, rol, especialidad, especialidad_key
        FROM users
       WHERE id = ${userId}
       LIMIT 1
    `);
    const row = (result.rows as unknown as UserProfileRow[])[0];
    return row ? toProfile(row) : null;
  }

  async updateEspecialidad(
    tx: Tx,
    userId: string,
    input: UpdateEspecialidadInput,
  ): Promise<UserProfile | null> {
    const result = await tx.execute(sql`
      UPDATE users
         SET especialidad = ${input.especialidad},
             especialidad_key = ${input.especialidadKey}
       WHERE id = ${userId}
      RETURNING id, nombre, rol, especialidad, especialidad_key
    `);
    const row = (result.rows as unknown as UserProfileRow[])[0];
    return row ? toProfile(row) : null;
  }
}
