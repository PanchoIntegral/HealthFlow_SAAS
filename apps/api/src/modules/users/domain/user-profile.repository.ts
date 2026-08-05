import type { UserProfile } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';

export interface UpdateEspecialidadInput {
  especialidadKey: string;
  especialidad: string | null;
}

/**
 * Puerto del perfil del usuario autenticado. Todos los métodos reciben la
 * transacción con el tenant fijado, por lo que RLS garantiza que un usuario
 * solo pueda leer/tocar su propio registro dentro de su propia clínica.
 */
export interface UserProfileRepository {
  getById(tx: Tx, userId: string): Promise<UserProfile | null>;

  /** Devuelve el perfil actualizado, o null si el usuario no existe en el tenant activo. */
  updateEspecialidad(tx: Tx, userId: string, input: UpdateEspecialidadInput): Promise<UserProfile | null>;

  /** Hash actual de la contraseña, o null si el usuario no existe en el tenant activo. */
  getPasswordHash(tx: Tx, userId: string): Promise<string | null>;

  /** true si actualizó una fila (existía en el tenant activo). */
  updatePasswordHash(tx: Tx, userId: string, newHash: string): Promise<boolean>;
}

export const USER_PROFILE_REPOSITORY = Symbol('USER_PROFILE_REPOSITORY');
