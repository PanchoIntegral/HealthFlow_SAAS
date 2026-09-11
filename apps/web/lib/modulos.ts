'use client';

import { useQuery } from '@tanstack/react-query';
import type { FeatureFlag, FeatureFlagView } from '@healthflow/shared-types';
import { api } from './api';

/**
 * Qué módulos tiene liberados la clínica (§5.8 del plan dental).
 *
 * Esto sirve para OCULTAR navegación, no para proteger nada: la barrera real
 * es el 404 `ModuloNoDisponible` que devuelve la API. Ocultar el menú es para
 * no ofrecerle al usuario una puerta que se le va a cerrar en la cara — mismo
 * criterio que la pestaña de facturación en /ajustes.
 *
 * `staleTime` alto a propósito: un módulo no se enciende a media sesión, y
 * esta consulta la haría cada pantalla con navegación.
 */
export function useModulos(token: string | null) {
  return useQuery({
    queryKey: ['modulos'],
    queryFn: () => api.modulos(token!),
    enabled: Boolean(token),
    staleTime: 5 * 60_000,
  });
}

/** `true` solo cuando ya se sabe que está encendido (nunca "optimista"). */
export function useModuloActivo(token: string | null, flag: FeatureFlag): boolean {
  const { data } = useModulos(token);
  return (data ?? []).some((m: FeatureFlagView) => m.flag === flag && m.habilitado);
}
