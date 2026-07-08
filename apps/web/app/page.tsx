'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth';

/** Raíz: redirige según haya sesión o no. */
export default function Home() {
  const { token, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    router.replace(token ? '/sala-de-espera' : '/login');
  }, [ready, token, router]);

  return <main className="grid min-h-screen place-items-center text-slate-400">Cargando…</main>;
}
