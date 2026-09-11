import { SetMetadata } from '@nestjs/common';
import type { FeatureFlag } from '@healthflow/shared-types';

export const REQUIERE_FLAG_KEY = 'requiere_feature_flag';

/**
 * Marca un controller (o un handler suelto) como perteneciente a un módulo
 * liberado por etapas. Si la clínica no tiene el flag encendido, la ruta
 * responde 404 `ModuloNoDisponible` — ver FeatureFlagInterceptor.
 *
 * Va en la CLASE del controller salvo excepción justificada: que un módulo
 * esté medio activo (unas rutas sí y otras no) es una fuente de bugs peor que
 * el flag mismo.
 *
 * Mismo patrón que @RequirePolicy y @PermitirSinSuscripcion.
 */
export const RequiereFlag = (flag: FeatureFlag) => SetMetadata(REQUIERE_FLAG_KEY, flag);
