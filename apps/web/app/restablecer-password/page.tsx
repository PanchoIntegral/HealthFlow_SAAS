'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';

/**
 * Página PÚBLICA (sin AppShell, sin guard de sesión) — el token viaja en la
 * URL, no hay JWT todavía. Al tener éxito, auto-loguea (mismo patrón que el
 * canje del ticket de Stripe) y manda a la app.
 */
export default function RestablecerPasswordPage() {
  return (
    <Suspense fallback={null}>
      <RestablecerPasswordForm />
    </Suspense>
  );
}

function RestablecerPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setSession } = useAuth();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expirado, setExpirado] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setExpirado(false);

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirmar) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setLoading(true);
    try {
      const session = await api.resetPassword(token, password);
      setSession(session);
      router.replace('/sala-de-espera');
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) {
        setExpirado(true);
      } else if (err instanceof ApiError && err.status === 400) {
        setError('Este enlace no es válido. Pide uno nuevo.');
      } else {
        setError('Error de conexión. Intenta de nuevo.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand-blue to-brand-green text-lg font-bold text-white">
            ✚
          </div>
          <span className="text-2xl font-bold">
            Health<span className="text-brand-teal">Flow</span>
          </span>
        </div>

        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold">Elige una contraseña nueva</h1>

          {!token ? (
            <p className="text-sm text-red-600">
              Falta el enlace de restablecimiento. Pide uno nuevo desde{' '}
              <Link href="/olvide-password" className="font-medium underline">
                aquí
              </Link>
              .
            </p>
          ) : expirado ? (
            <>
              <p className="text-sm text-slate-600">
                Este enlace ya expiró (son válidos 30 minutos). Pide uno nuevo.
              </p>
              <Link href="/olvide-password" className="block text-sm font-medium text-brand-blue hover:underline">
                Pedir un enlace nuevo →
              </Link>
            </>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-600">Contraseña nueva</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20"
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-600">Confirmar contraseña</span>
                <input
                  type="password"
                  value={confirmar}
                  onChange={(e) => setConfirmar(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20"
                />
              </label>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-gradient-to-r from-brand-blue to-brand-green py-2.5 font-semibold text-white transition hover:opacity-95 disabled:opacity-50"
              >
                {loading ? 'Guardando…' : 'Guardar contraseña'}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
