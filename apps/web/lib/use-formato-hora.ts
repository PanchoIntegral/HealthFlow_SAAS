'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './auth';
import type { FormatoHora } from './formato-hora';

/**
 * Preferencia personal de formato de hora ('12h' | '24h'), editable en
 * Ajustes. Mismo patrón que useClinicaDental: comparte la clave 'mi-perfil'
 * (GET /users/me) con el resto de la app, así que react-query la sirve de
 * caché en vez de repetir la lectura en cada pantalla.
 *
 * Devuelve '24h' mientras carga o si no hay sesión — es el default de
 * cuentas nuevas, así que no hay parpadeo hacia el formato "equivocado".
 */
export function useFormatoHora(): FormatoHora {
  const { token } = useAuth();

  const perfil = useQuery({
    queryKey: ['mi-perfil'],
    queryFn: () => api.getMyProfile(token!),
    enabled: !!token,
    staleTime: 5 * 60_000,
  });

  return perfil.data?.formatoHora ?? '24h';
}
