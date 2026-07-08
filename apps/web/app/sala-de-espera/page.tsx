'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { WaitingRoomEntry } from '@healthflow/shared-types';
import { useAuth } from '../../lib/auth';
import { api, ApiError } from '../../lib/api';
import { useWaitingRoom, WAITING_ROOM_QUERY_KEY } from '../../lib/use-waiting-room';
import { WaitingRoomCard } from '../../components/waiting-room-card';
import { AppShell } from '../../components/app-shell';

export default function SalaDeEsperaPage() {
  const router = useRouter();
  const { token, user, ready } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (ready && !token) router.replace('/login');
  }, [ready, token, router]);

  const { data: entries, isLoading } = useWaitingRoom(token ?? '');

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

  return (
    <AppShell>
      <div className="p-8">
        <div className="mb-6">
          <div className="flex items-center gap-2 text-sm text-emerald-600">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            En vivo
          </div>
          <h1 className="text-2xl font-bold">Sala de espera</h1>
        </div>

        {isLoading && <p className="text-slate-400">Cargando pacientes…</p>}

        {entries && entries.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
            No hay citas para hoy.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {entries?.map((entry) => (
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
            />
          ))}
        </div>
      </div>
    </AppShell>
  );
}
