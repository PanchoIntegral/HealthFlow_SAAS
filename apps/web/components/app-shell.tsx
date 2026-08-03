'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { NotificationsBell } from './notifications-bell';
import {
  IconBudget,
  IconCalendar,
  IconDashboard,
  IconFinance,
  IconRecords,
  IconReports,
  IconWaiting,
} from './icons';

/** `roles` limita el item a esos roles; sin `roles`, lo ven todos. */
const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: IconDashboard },
  { href: '/calendario', label: 'Calendario', icon: IconCalendar },
  { href: '/sala-de-espera', label: 'Sala de espera', icon: IconWaiting },
  { href: '/pacientes', label: 'Expedientes', icon: IconRecords },
  // Todos los roles pueden leer presupuestos (el asistente cobra, el médico
  // cotiza): sin `roles`, igual que Dashboard/Calendario.
  { href: '/presupuestos', label: 'Presupuestos', icon: IconBudget },
  { href: '/reportes', label: 'Reportes', icon: IconReports },
  { href: '/finanzas', label: 'Finanzas', icon: IconFinance, roles: ['medico', 'admin'] },
] as { href: string; label: string; icon: () => React.JSX.Element; roles?: string[] }[];

function initials(nombre: string): string {
  return nombre.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase();
}

const ESPECIALIDAD: Record<string, string> = {
  medico: 'Medicina',
  asistente: 'Asistente',
  admin: 'Administración',
};

/**
 * Layout base de la app autenticada: sidebar fija + área de contenido.
 * Protege la ruta (redirige a /login si no hay sesión).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { token, user, ready, logout } = useAuth();

  useEffect(() => {
    if (ready && !token) router.replace('/login');
  }, [ready, token, router]);

  if (!ready || !token || !user) return null;

  return (
    <div className="flex min-h-screen bg-slate-100">
      <aside className="fixed inset-y-0 left-0 flex w-60 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-blue to-brand-green text-white">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12h4l2 5 4-12 2 7h6" />
              </svg>
            </div>
            <span className="text-lg font-bold">
              Health<span className="text-brand-teal">Flow</span>
            </span>
          </div>
          <NotificationsBell />
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {NAV.filter(({ roles }) => !roles || roles.includes(user.rol)).map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href === '/pacientes' && pathname.startsWith('/pacientes'));
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? 'bg-brand-blue/10 text-brand-blue'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                }`}
              >
                <Icon />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-100 p-3">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-blue/10 text-sm font-semibold text-brand-blue">
              {initials(user.nombre)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{user.nombre}</p>
              <p className="truncate text-xs text-slate-400">{ESPECIALIDAD[user.rol] ?? user.rol}</p>
            </div>
            <button onClick={logout} title="Cerrar sesión" className="text-slate-300 hover:text-slate-500">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      <main className="ml-60 flex-1">{children}</main>
    </div>
  );
}
