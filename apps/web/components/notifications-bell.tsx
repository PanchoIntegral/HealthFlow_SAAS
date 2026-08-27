'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { NotificationType, NotificationView } from '@healthflow/shared-types';
import { useAuth } from '../lib/auth';
import { useNotifications } from '../lib/use-notifications';
import { IconAlertTriangle, IconBell, IconClock, IconWaiting, IconXCircle } from './icons';

const ICONOS: Record<NotificationType, (props: { size?: number }) => React.JSX.Element> = {
  cita_proxima: IconClock,
  checkin: IconWaiting,
  cita_cancelada: IconXCircle,
  factura_error: IconAlertTriangle,
};

const COLORES: Record<NotificationType, string> = {
  cita_proxima: 'bg-brand-blue/10 text-brand-blue',
  checkin: 'bg-amber-100 text-amber-700',
  cita_cancelada: 'bg-red-100 text-red-600',
  factura_error: 'bg-red-100 text-red-600',
};

function tiempoRelativo(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(iso).toLocaleDateString('es-MX');
}

/**
 * Campanita de notificaciones, montada una sola vez en AppShell (visible en
 * todas las páginas). Panel desplegable propio: no existe un patrón de
 * dropdown reusable en el repo, así que el cierre por click-fuera se resuelve
 * aquí mismo en vez de abstraerlo en un hook genérico.
 */
export function NotificationsBell() {
  const { token } = useAuth();
  const router = useRouter();
  const { data: items, markRead, markAllRead } = useNotifications(token ?? '');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!token) return null;

  const unread = (items ?? []).filter((n) => !n.leidaAt).length;

  function onClickItem(n: NotificationView) {
    if (!n.leidaAt) markRead.mutate(n.id);
    if (n.appointmentId) router.push('/sala-de-espera');
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Notificaciones"
        className="relative grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
      >
        <IconBell />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* En escritorio la campanita vive en la barra lateral y el panel sale
          hacia la derecha; en la cabecera móvil está pegada al borde derecho,
          así que ahí cuelga hacia abajo y se limita al ancho de la pantalla. */}
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl lg:left-full lg:right-auto lg:top-0 lg:ml-2 lg:mt-0 lg:w-96">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-semibold">Notificaciones</h3>
            {unread > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                className="text-xs font-medium text-brand-blue hover:underline"
              >
                Marcar todas como leídas
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {!items || items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">No tienes notificaciones.</p>
            ) : (
              <ul className="divide-y divide-slate-50">
                {items.map((n) => {
                  const Icon = ICONOS[n.tipo];
                  return (
                    <li key={n.id}>
                      <button
                        onClick={() => onClickItem(n)}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${
                          !n.leidaAt ? 'bg-brand-blue/[0.03]' : ''
                        }`}
                      >
                        <span
                          className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${COLORES[n.tipo]}`}
                        >
                          <Icon size={15} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-semibold">{n.titulo}</span>
                            {!n.leidaAt && (
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-blue" />
                            )}
                          </span>
                          <span className="block truncate text-xs text-slate-500">{n.mensaje}</span>
                          <span className="block text-[11px] text-slate-400">
                            {tiempoRelativo(n.createdAt)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
