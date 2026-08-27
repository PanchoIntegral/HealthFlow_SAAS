'use client';

import { useEffect, useState } from 'react';

/**
 * Media query en JS. Solo para lo que CSS no puede resolver: decidir en qué
 * lugar del árbol se **monta** un componente (la campanita abre un WebSocket,
 * así que no vale duplicarla y esconder una con `hidden`). Para mostrar u
 * ocultar, usa las clases responsive de Tailwind.
 *
 * En el servidor devuelve `false`; el AppShell no pinta nada hasta tener
 * sesión (todo ocurre en cliente), así que no hay desajuste de hidratación.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
