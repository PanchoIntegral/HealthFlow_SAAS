'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './auth';

/**
 * ¿La clínica ejerce odontología? Decide si se dibujan los presupuestos y las
 * piezas dentales, que en cualquier otra especialidad son campos que nadie
 * puede llenar.
 *
 * Comparte la clave 'mi-perfil' con la pantalla de consulta a propósito: es la
 * misma lectura de GET /users/me, así que react-query la sirve de caché en vez
 * de repetirla en cada navegación.
 *
 * Devuelve `undefined` mientras carga, y quien lo consume trata ese estado como
 * "todavía no": vale más que a un dentista le aparezca la sección un instante
 * después, a que a un podólogo le parpadee una que no le toca.
 */
export function useClinicaDental(): boolean | undefined {
  const { token } = useAuth();

  const perfil = useQuery({
    queryKey: ['mi-perfil'],
    queryFn: () => api.getMyProfile(token!),
    enabled: !!token,
    // El flag solo cambia cuando alguien edita su especialidad en Ajustes,
    // que es raro; no hace falta revalidarlo en cada montaje.
    staleTime: 5 * 60_000,
  });

  return perfil.data?.clinicaDental;
}
