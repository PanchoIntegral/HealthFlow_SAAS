import { SetMetadata } from '@nestjs/common';

export const PERMITIR_SIN_SUSCRIPCION_KEY = 'permitir_sin_suscripcion';

/**
 * Deja pasar esta escritura aunque la suscripción esté vencida.
 *
 * Reservado para lo que el usuario necesita PODER hacer justamente cuando
 * está suspendido: pagar (el portal de Stripe), cuidar su cuenta (cambiar
 * contraseña) y operaciones de UI sin valor clínico (marcar notificaciones
 * leídas). Cualquier cosa que registre datos de pacientes NO va aquí.
 *
 * Mismo patrón que @RequirePolicy (modules/auth/casl/policies.guard.ts).
 */
export const PermitirSinSuscripcion = () => SetMetadata(PERMITIR_SIN_SUSCRIPCION_KEY, true);
