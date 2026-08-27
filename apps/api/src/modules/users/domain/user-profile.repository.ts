import type { UserProfile } from '@healthflow/shared-types';
import type { Tx } from '../../../db/drizzle';

/**
 * El perfil tal como vive en la tabla `users`.
 *
 * `asistenteIaActivo`, `clinicaDental`, `direccionClinica` y `telefonoClinica`
 * quedan fuera a propósito: son del TENANT, no del usuario. El caso de uso
 * los compone antes de responder; el repositorio no tiene por qué saber que
 * existen.
 */
export type PerfilPersistido = Omit<
  UserProfile,
  'asistenteIaActivo' | 'clinicaDental' | 'direccionClinica' | 'telefonoClinica'
>;

export interface UpdatePerfilInput {
  especialidadKey: string;
  especialidad: string | null;
  /** 'Dr.' | 'Dra.'. null = sin título en el membrete. */
  titulo: string | null;
  /** null = borrar la cédula guardada. */
  cedulaProfesional: string | null;
  /** null = borrar la cédula guardada. */
  cedulaEspecialidad: string | null;
  /** Institución que expidió el título (RIS art. 64). null = borrar. */
  institucionTitulo: string | null;
  formatoHora: '12h' | '24h';
}

/**
 * Puerto del perfil del usuario autenticado. Todos los métodos reciben la
 * transacción con el tenant fijado, por lo que RLS garantiza que un usuario
 * solo pueda leer/tocar su propio registro dentro de su propia clínica.
 */
export interface UserProfileRepository {
  getById(tx: Tx, userId: string): Promise<PerfilPersistido | null>;

  /** Devuelve el perfil actualizado, o null si el usuario no existe en el tenant activo. */
  updatePerfil(tx: Tx, userId: string, input: UpdatePerfilInput): Promise<PerfilPersistido | null>;

  /** Hash actual de la contraseña, o null si el usuario no existe en el tenant activo. */
  getPasswordHash(tx: Tx, userId: string): Promise<string | null>;

  /** true si actualizó una fila (existía en el tenant activo). */
  updatePasswordHash(tx: Tx, userId: string, newHash: string): Promise<boolean>;
}

export const USER_PROFILE_REPOSITORY = Symbol('USER_PROFILE_REPOSITORY');
