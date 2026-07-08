'use client';

import { AppShell } from './app-shell';

/** Página placeholder para módulos aún no construidos (Calendario, Reportes). */
export function ComingSoon({ titulo, descripcion }: { titulo: string; descripcion: string }) {
  return (
    <AppShell>
      <div className="grid min-h-screen place-items-center p-8">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-blue/10 text-2xl">
            🚧
          </div>
          <h1 className="mb-2 text-2xl font-bold">{titulo}</h1>
          <p className="text-slate-500">{descripcion}</p>
          <p className="mt-4 text-sm text-slate-400">Próxima iteración.</p>
        </div>
      </div>
    </AppShell>
  );
}
