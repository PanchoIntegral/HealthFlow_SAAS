'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { useClinicaDental } from '../lib/use-clinica-dental';
import { useMediaQuery } from '../lib/use-media-query';
import { BannerSuscripcion } from './banner-suscripcion';
import { NotificationsBell } from './notifications-bell';
import { UserMenu } from './user-menu';
import {
  IconBudget,
  IconCalendar,
  IconCash,
  IconDashboard,
  IconFinance,
  IconMenu,
  IconRecords,
  IconReports,
  IconSettings,
  IconWaiting,
  IconX,
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
  // Caja y Reportes: solo médico/admin. Decisión explícita del titular — el
  // asistente sí agenda, cobra facturas y abona presupuestos, pero no abre el
  // corte de caja ni ve los reportes del consultorio.
  { href: '/caja', label: 'Caja', icon: IconCash, roles: ['medico', 'admin'] },
  { href: '/reportes', label: 'Reportes', icon: IconReports, roles: ['medico', 'admin'] },
  // Finanzas: oculto temporalmente del menú a petición del usuario. La ruta
  // /finanzas y su permiso siguen existiendo; para volver a mostrarlo basta
  // con descomentar esta línea.
  // { href: '/finanzas', label: 'Finanzas', icon: IconFinance, roles: ['medico', 'admin'] },
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

/** A partir de `lg` la barra lateral es fija; por debajo es un cajón. */
const ESCRITORIO = '(min-width: 1024px)';

/**
 * Layout base de la app autenticada: barra lateral + área de contenido.
 * Protege la ruta (redirige a /login si no hay sesión).
 *
 * Responsive: de `lg` en adelante la barra es fija y el contenido se recorre
 * 240px (`lg:ml-60`). Por debajo, la barra sale de pantalla y se abre como
 * cajón desde la cabecera móvil; el `ml` no aplica, que era justo lo que
 * provocaba scroll horizontal en teléfono.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { token, user, ready } = useAuth();
  const clinicaDental = useClinicaDental();
  const escritorio = useMediaQuery(ESCRITORIO);
  const [cajonAbierto, setCajonAbierto] = useState(false);

  useEffect(() => {
    if (ready && !token) router.replace('/login');
  }, [ready, token, router]);

  // Navegar cierra el cajón: en teléfono tapa toda la pantalla.
  useEffect(() => setCajonAbierto(false), [pathname]);

  if (!ready || !token || !user) return null;

  return (
    <div className="flex min-h-screen bg-slate-100">
      {/* Cabecera solo de teléfono/tablet: es el único acceso al cajón. */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setCajonAbierto(true)}
          aria-label="Abrir menú"
          aria-expanded={cajonAbierto}
          className="grid h-9 w-9 place-items-center rounded-xl text-slate-600 hover:bg-slate-100"
        >
          <IconMenu />
        </button>
        <Logo />
        {escritorio ? <div className="h-9 w-9" /> : <NotificationsBell />}
      </header>

      {/* Fondo oscuro del cajón; también cierra al tocarlo. */}
      {cajonAbierto && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
          onClick={() => setCajonAbierto(false)}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-slate-200 bg-white transition-transform lg:z-30 lg:translate-x-0 ${
          cajonAbierto ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-6 py-5">
          <Logo />
          {/* La campanita abre un WebSocket: se monta en un solo sitio, aquí
              en escritorio y en la cabecera móvil por debajo de `lg`. */}
          {escritorio ? (
            <NotificationsBell />
          ) : (
            <button
              type="button"
              onClick={() => setCajonAbierto(false)}
              aria-label="Cerrar menú"
              className="grid h-9 w-9 place-items-center rounded-xl text-slate-600 hover:bg-slate-100"
            >
              <IconX />
            </button>
          )}
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

      <main className="min-w-0 flex-1 pt-14 lg:ml-60 lg:pt-0">
        {/* Arriba de todo y en todas las pantallas: si la cuenta está vencida,
            el usuario tiene que enterarse antes de intentar guardar algo. */}
        <BannerSuscripcion />
        {children}
      </main>
    </div>
  );
}

function Logo() {
  return (
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
  );
}
