'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AppointmentStatus, WaitingRoomEntry } from '@healthflow/shared-types';
import { useAuth } from '../../lib/auth';
import { api, ApiError } from '../../lib/api';
import { useWaitingRoom, WAITING_ROOM_QUERY_KEY } from '../../lib/use-waiting-room';
import { WaitingRoomCard, dragMimeType } from '../../components/waiting-room-card';
import { AppShell } from '../../components/app-shell';

const TERMINAL: AppointmentStatus[] = ['finalizada', 'cancelada', 'no_asistio'];

const COLUMNS: {
  key: string;
  title: string;
  dot: string;
  statuses: AppointmentStatus[];
  empty: string;
}[] = [
  { key: 'agendada', title: 'Por llegar', dot: 'bg-slate-400', statuses: ['agendada'], empty: 'Nadie por llegar todavía.' },
  { key: 'en_espera', title: 'En espera', dot: 'bg-amber-500', statuses: ['en_espera'], empty: 'Nadie en espera.' },
  { key: 'en_consulta', title: 'En consulta', dot: 'bg-brand-blue', statuses: ['en_consulta'], empty: 'Sin consultas en curso.' },
  { key: 'finalizada', title: 'Atendidos hoy', dot: 'bg-emerald-500', statuses: TERMINAL, empty: 'Aún no hay atendidos.' },
];

export default function SalaDeEsperaPage() {
  const router = useRouter();
  const { token, user, ready } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (ready && !token) router.replace('/login');
  }, [ready, token, router]);

  const { data: entries, isLoading } = useWaitingRoom(token ?? '');
  const [draggingStatus, setDraggingStatus] = useState<AppointmentStatus | null>(null);

  const checkIn = useMutation({
    mutationFn: (appointmentId: string) => api.checkIn(token!, appointmentId),
    onSuccess: (updated) => {
      // Actualización optimista local; los demás clientes se enteran por WebSocket.
      queryClient.setQueryData<WaitingRoomEntry[]>(WAITING_ROOM_QUERY_KEY, (prev) =>
        prev?.map((e) => (e.appointmentId === updated.appointmentId ? updated : e)),
      );
    },
    onError: (err) => {
      alert(err instanceof ApiError ? err.message : 'Error al hacer check-in');
    },
  });

  const startConsultation = useMutation({
    mutationFn: (appointmentId: string) => api.startConsultation(token!, appointmentId),
    onSuccess: (res) => {
      router.push(`/consulta/${res.appointmentId}?patientId=${res.patientId}`);
    },
    onError: (err) => {
      alert(err instanceof ApiError ? err.message : 'Error al iniciar la consulta');
    },
  });

  if (!ready || !token || !user) return null;

  const canCheckIn = ['asistente', 'medico', 'admin'].includes(user.rol);
  const canConsult = ['medico', 'admin'].includes(user.rol);

  // Drag-and-drop: mismos procesos que ya existen como botones (marcar
  // llegada, iniciar consulta), solo que arrastrando la tarjeta a la columna
  // siguiente. Cada columna solo acepta el estatus que legítimamente puede
  // avanzar hacia ella (y solo si el rol del usuario puede hacer esa acción).
  const acceptsFrom: Record<string, AppointmentStatus[]> = {
    agendada: [],
    en_espera: canCheckIn ? ['agendada'] : [],
    en_consulta: canConsult ? ['en_espera'] : [],
    finalizada: [],
  };

  function handleDropOnColumn(colKey: string, e: React.DragEvent) {
    for (const fromStatus of acceptsFrom[colKey] ?? []) {
      const appointmentId = e.dataTransfer.getData(dragMimeType(fromStatus));
      if (!appointmentId) continue;
      if (fromStatus === 'agendada' && colKey === 'en_espera') checkIn.mutate(appointmentId);
      if (fromStatus === 'en_espera' && colKey === 'en_consulta') startConsultation.mutate(appointmentId);
      return;
    }
  }

  const porStatus = (statuses: AppointmentStatus[]) => {
    const list = (entries ?? []).filter((e) => statuses.includes(e.estatus));
    if (statuses.length === 1 && statuses[0] === 'en_espera') {
      return [...list].sort((a, b) => (a.checkinAt ?? '').localeCompare(b.checkinAt ?? ''));
    }
    return list;
  };

  const enEspera = porStatus(['en_espera']);

  return (
    <AppShell>
      <div>
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-8 py-4">
          <div>
            <h1 className="text-xl font-bold">Sala de espera</h1>
            {(canCheckIn || canConsult) && (
              <p className="text-sm text-slate-500">Arrastra una tarjeta a la siguiente columna para avanzarla.</p>
            )}
          </div>
          {entries && entries.length > 0 && (
            <p className="text-sm text-slate-500">
              {entries.length} {entries.length === 1 ? 'cita hoy' : 'citas hoy'}
              {enEspera.length > 0 && ` · ${enEspera.length} en espera`}
            </p>
          )}
        </header>

        <div className="p-8">
          {isLoading && <p className="text-slate-400">Cargando pacientes…</p>}

          {entries && entries.length === 0 && (
            <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-400">
              No hay citas para hoy.
            </p>
          )}

          {entries && entries.length > 0 && (
            <div className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-4">
              {COLUMNS.map((col) => {
                const list = porStatus(col.statuses);
                return (
                  <Column
                    key={col.key}
                    title={col.title}
                    dot={col.dot}
                    count={list.length}
                    empty={col.empty}
                    acceptsFrom={acceptsFrom[col.key] ?? []}
                    draggingStatus={draggingStatus}
                    onDropCard={(e) => handleDropOnColumn(col.key, e)}
                  >
                    {list.map((entry) => (
                      <WaitingRoomCard
                        key={entry.appointmentId}
                        entry={entry}
                        canCheckIn={canCheckIn}
                        canConsult={canConsult}
                        onCheckIn={(id) => checkIn.mutate(id)}
                        onStartConsultation={(id) => startConsultation.mutate(id)}
                        pending={
                          (checkIn.isPending && checkIn.variables === entry.appointmentId) ||
                          (startConsultation.isPending && startConsultation.variables === entry.appointmentId)
                        }
                        draggable={
                          (entry.estatus === 'agendada' && canCheckIn) ||
                          (entry.estatus === 'en_espera' && canConsult)
                        }
                        onDragStatusChange={setDraggingStatus}
                      />
                    ))}
                  </Column>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Column({
  title,
  dot,
  count,
  empty,
  children,
  acceptsFrom,
  draggingStatus,
  onDropCard,
}: {
  title: string;
  dot: string;
  count: number;
  empty: string;
  children: ReactNode;
  acceptsFrom: AppointmentStatus[];
  draggingStatus: AppointmentStatus | null;
  onDropCard: (e: React.DragEvent) => void;
}) {
  const [over, setOver] = useState(false);
  const isValidTarget = draggingStatus !== null && acceptsFrom.includes(draggingStatus);

  return (
    <div
      onDragOver={(e) => {
        if (!isValidTarget) return;
        e.preventDefault();
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (isValidTarget) onDropCard(e);
      }}
      className={`flex flex-col rounded-2xl border p-4 transition ${
        over
          ? 'border-brand-blue bg-brand-blue/5 ring-2 ring-brand-blue/30'
          : isValidTarget
            ? 'border-dashed border-brand-blue/40 bg-slate-50/60'
            : draggingStatus !== null
              ? 'border-slate-200 bg-slate-50/60 opacity-50'
              : 'border-slate-200 bg-slate-50/60'
      }`}
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-500">
          {count}
        </span>
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto pr-0.5" style={{ maxHeight: 'calc(100vh - 320px)' }}>
        {count > 0 ? (
          children
        ) : (
          <p
            className={`rounded-xl border border-dashed py-6 text-center text-xs transition ${
              isValidTarget ? 'border-brand-blue/40 text-brand-blue' : 'border-slate-200 text-slate-400'
            }`}
          >
            {isValidTarget ? 'Suelta aquí' : empty}
          </p>
        )}
      </div>
    </div>
  );
}
