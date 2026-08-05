'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { IconChevronUpDown, IconLogout, IconSettings, IconUsers } from './icons';

const ETIQUETA_ROL: Record<string, string> = {
  medico: 'Medicina',
  asistente: 'Asistente',
  admin: 'Administración',
};

function initials(nombre: string): string {
  return nombre
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();
}

/**
 * Chip del usuario en la barra lateral, convertido en menú.
 *
 * "Cuentas" vive aquí y no en la navegación principal a propósito: administrar
 * al equipo es algo que se hace dos o tres veces en la vida de un consultorio,
 * y ocupando un lugar fijo en el menú competiría cada día con las pantallas que
 * sí se usan cada día. Solo lo ve el titular — para los demás, el menú tiene
 * dos opciones y sigue siendo trivial.
 */
export function UserMenu() {
  const { user, logout } = useAuth();
  const [abierto, setAbierto] = useState(false);
  const contenedor = useRef<HTMLDivElement>(null);

  // Cierra al hacer click fuera o con Escape: un menú que se queda pegado
  // encima del contenido es peor que no tener menú.
  useEffect(() => {
    if (!abierto) return;
    const onClick = (e: MouseEvent) => {
      if (!contenedor.current?.contains(e.target as Node)) setAbierto(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [abierto]);

  if (!user) return null;

  const esTitular = user.rol === 'admin';

  return (
    <div ref={contenedor} className="relative">
      {abierto && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-40 mb-2 w-full min-w-[13rem] overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg shadow-slate-900/5"
        >
          <div className="border-b border-slate-100 px-3 pb-2 pt-1">
            <p className="truncate text-sm font-semibold">{user.nombre}</p>
            <p className="truncate text-xs text-slate-400">
              {ETIQUETA_ROL[user.rol] ?? user.rol}
              {esTitular && ' · Titular'}
            </p>
          </div>

          {esTitular && (
            <MenuItem href="/cuentas" onNavigate={() => setAbierto(false)} icon={<IconUsers size={16} />}>
              Cuentas
              <span className="ml-auto rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                equipo
              </span>
            </MenuItem>
          )}

          <MenuItem href="/ajustes" onNavigate={() => setAbierto(false)} icon={<IconSettings size={16} />}>
            Ajustes
          </MenuItem>

          <div className="my-1 border-t border-slate-100" />

          <button
            role="menuitem"
            onClick={logout}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50 hover:text-red-600"
          >
            <IconLogout size={16} />
            Cerrar sesión
          </button>
        </div>
      )}

      <button
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={abierto}
        className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition ${
          abierto ? 'bg-slate-100' : 'hover:bg-slate-50'
        }`}
      >
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-blue/10 text-sm font-semibold text-brand-blue">
          {initials(user.nombre)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{user.nombre}</p>
          <p className="truncate text-xs text-slate-400">{ETIQUETA_ROL[user.rol] ?? user.rol}</p>
        </div>
        <span className="shrink-0 text-slate-300">
          <IconChevronUpDown size={16} />
        </span>
      </button>
    </div>
  );
}

function MenuItem({
  href,
  icon,
  children,
  onNavigate,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onNavigate: () => void;
}) {
  return (
    <Link
      role="menuitem"
      href={href}
      onClick={onNavigate}
      className="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
    >
      <span className="shrink-0 text-slate-400">{icon}</span>
      {children}
    </Link>
  );
}
