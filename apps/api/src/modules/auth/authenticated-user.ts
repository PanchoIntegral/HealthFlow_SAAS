import type { UserRole } from '@healthflow/shared-types';

/** Forma del JWT emitido al iniciar sesión. */
export interface JwtPayload {
  sub: string; // userId
  tid: string; // tenantId
  rol: UserRole;
}

/** Usuario adjuntado a la petición (req.user) tras validar el JWT. */
export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  rol: UserRole;
}
