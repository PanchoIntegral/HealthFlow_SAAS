'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { useClinicaDental } from '../lib/use-clinica-dental';
import { BannerSuscripcion } from './banner-suscripcion';
import { NotificationsBell } from './notifications-bell';
import { UserMenu } from './user-menu';
import {
  IconBudget,
  IconCalendar,
  IconDashboard,
  IconFinance,
  IconRecords,
  IconReports,
  IconSettings,
  IconWaiting,
} from './icons';

/**
 * `roles` limita el item a esos roles; sin `roles`, lo ven todos.
 * `soloDental` lo limita además a las clínicas que ejercen odontología.
 */
const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: IconDashboard },
  { href: '/calendario', label: 'Calendario', icon: IconCalendar },
  { href: '/sala-de-espera', label: 'Sala de espera', icon: IconWaiting },
  { href: '/pacientes', label: 'Expedientes', icon: IconRecords },
  // Todos los ROLES pueden leer presupuestos (el asistente cobra, el médico
  // cotiza), pero solo en un consultorio dental: el módulo cotiza por pieza
  // (notación FDI) y nace del odontograma, y a un pediatra o un podólogo no
  // le sirve de nada. Por eso `soloDental` y no `roles`.
  { href: '/presupuestos', label: 'Presupuestos', icon: IconBudget, soloDental: true },
  { href: '/reportes', label: 'Reportes', icon: IconReports },
  { href: '/finanzas', label: 'Finanzas', icon: IconFinance, roles: ['medico', 'admin'] },
  // Autoservicio sobre el propio registro: cualquier rol puede ajustar su
  // especialidad, sin restricción por `roles`.
  { href: '/ajustes', label: 'Ajustes', icon: IconSettings },
] as {
  href: string;
  label: string;
  icon: () => React.JSX.Element;
  roles?: string[];
  soloDental?: boolean;
}[];

/**
 * Layout base de la app autenticada: sidebar fija + área de contenido.
 * Protege la ruta (redirige a /login si no hay sesión).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { token, user, ready } = useAuth();
  const clinicaDental = useClinicaDental();

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
          {NAV.filter(
            ({ roles, soloDental }) =>
              (!roles || roles.includes(user.rol)) && (!soloDental || clinicaDental === true),
          ).map(({ href, label, icon: Icon }) => {
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

        {/* El nombre del usuario abre el menú de cuenta (Cuentas, Ajustes, salir). */}
        <div className="border-t border-slate-100 p-3">
          <UserMenu />
        </div>
      </aside>

      <main className="ml-60 flex-1">
        {/* Arriba de todo y en todas las pantallas: si la cuenta está vencida,
            el usuario tiene que enterarse antes de intentar guardar algo. */}
        <BannerSuscripcion />
        {children}
      </main>
    </div>
  );
}
