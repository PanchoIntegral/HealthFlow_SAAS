import { SetMetadata } from '@nestjs/common';
import type { FeatureFlag } from '@healthflow/shared-types';

export const REQUIERE_MODULO_KEY = 'requiere_modulo';

/**
 * Marca un controller (o un handler suelto) como perteneciente a un módulo
 * con capacidad condicionada. Si la clínica no lo tiene contratado, liberado y
 * activado, la ruta responde 404 `ModuloNoDisponible` — ver CapacidadInterceptor.
 *
 * Va en la CLASE del controller salvo excepción justificada: que un módulo
 * esté medio activo (unas rutas sí y otras no) es una fuente de bugs peor que
 * el control mismo.
 *
 * Mismo patrón que @RequirePolicy y @PermitirSinSuscripcion.
 */
export const RequiereModulo = (modulo: FeatureFlag) => SetMetadata(REQUIERE_MODULO_KEY, modulo);
