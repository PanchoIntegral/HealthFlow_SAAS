'use client';

import { useQuery } from '@tanstack/react-query';
import type { FeatureFlag, ModuloView } from '@healthflow/shared-types';
import { api } from './api';

/**
 * Qué módulos puede usar la clínica, con sus cuatro ejes separados (ADR 0004).
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

/**
 * `true` sólo cuando ya se sabe que el módulo está DISPONIBLE — contratado,
 * liberado y activado. Nunca optimista: mientras carga devuelve `false`, para
 * que la navegación no parpadee mostrando algo que después desaparece.
 */
export function useModuloActivo(token: string | null, flag: FeatureFlag): boolean {
  const { data } = useModulos(token);
  return (data ?? []).some((m: ModuloView) => m.flag === flag && m.disponible);
}
