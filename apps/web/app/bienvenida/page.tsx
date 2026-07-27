'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const POLL_INTERVAL_MS = 1_500;
const POLL_TIMEOUT_MS = 30_000;

/**
 * A dónde manda Stripe tras un checkout exitoso (success_url). El webhook y
 * este redirect del browser llegan en un orden independiente, así que
 * normalmente hay que esperar unos segundos a que el webhook provisione el
 * tenant+usuario antes de poder canjear el ticket.
 */
function Bienvenida() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token, ready, setSession } = useAuth();
  const [status, setStatus] = useState<'checking' | 'error'>('checking');
  const startedRef = useRef(false);

  const sessionId = searchParams.get('session_id');

  useEffect(() => {
    if (!ready) return;

    // Ya hay sesión (p.ej. se refrescó la página tras un canje exitoso).
    if (token) {
      router.replace('/sala-de-espera');
      return;
    }

    if (!sessionId) {
      setStatus('error');
      return;
    }

    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    async function poll() {
      try {
        const result = await api.exchangeOnboardingTicket(sessionId!);
        if (cancelled) return;

        if ('status' in result) {
          // 202: el webhook de Stripe aún no termina de provisionar la cuenta.
          if (Date.now() >= deadline) {
            setStatus('error');
            return;
          }
          setTimeout(poll, POLL_INTERVAL_MS);
          return;
        }

        setSession(result);
        router.replace('/sala-de-espera');
      } catch {
        // 410: ticket expirado o ya usado.
        if (!cancelled) setStatus('error');
      }
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, [ready, token, sessionId, router, setSession]);

  if (status === 'error') {
    return (
      <div className="w-full max-w-sm text-center">
        <h1 className="mb-2 text-lg font-semibold">No pudimos confirmar tu pago</h1>
        <p className="mb-6 text-sm text-slate-600">
          Si ya pagaste, tu cuenta puede tardar unos minutos más en activarse. El correo y la
          contraseña que elegiste ya funcionan para iniciar sesión.
        </p>
        <a
          href="/login"
          className="inline-block rounded-lg bg-gradient-to-r from-brand-blue to-brand-green px-4 py-2.5 font-semibold text-white transition hover:opacity-95"
        >
          Ir a iniciar sesión
        </a>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm text-center">
      <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-brand-blue" />
      <h1 className="text-lg font-semibold">Estamos preparando tu cuenta…</h1>
      <p className="mt-2 text-sm text-slate-600">Esto toma solo unos segundos.</p>
    </div>
  );
}

export default function BienvenidaPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <Suspense fallback={null}>
        <Bienvenida />
      </Suspense>
    </main>
  );
}
