'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';

/**
 * Página PÚBLICA (sin AppShell, sin guard de sesión) — mismo layout
 * standalone que /login. El mensaje tras enviar es SIEMPRE el mismo, exista
 * o no la cuenta: nunca confirma ni niega que un correo esté registrado.
 */
export default function OlvidePasswordPage() {
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.forgotPassword(email);
    } finally {
      // Se muestra el mismo mensaje incluso si la petición falla (red, etc.):
      // no hay forma de distinguir eso de "el correo no existe" desde aquí.
      setLoading(false);
      setEnviado(true);
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
          <h1 className="text-lg font-semibold">Recuperar contraseña</h1>

          {enviado ? (
            <>
              <p className="text-sm text-slate-600">
                Si <strong>{email}</strong> tiene una cuenta con nosotros, te llegará un correo con
                instrucciones para elegir una contraseña nueva. El enlace es válido por 30 minutos.
              </p>
              <Link href="/login" className="block text-sm font-medium text-brand-blue hover:underline">
                ← Volver a iniciar sesión
              </Link>
            </>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <p className="text-sm text-slate-500">
                Ingresa tu correo y te mandamos un enlace para restablecer tu contraseña.
              </p>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-600">Correo</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20"
                />
              </label>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-gradient-to-r from-brand-blue to-brand-green py-2.5 font-semibold text-white transition hover:opacity-95 disabled:opacity-50"
              >
                {loading ? 'Enviando…' : 'Enviar enlace'}
              </button>
              <Link href="/login" className="block text-center text-sm text-slate-500 hover:underline">
                ← Volver a iniciar sesión
              </Link>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
