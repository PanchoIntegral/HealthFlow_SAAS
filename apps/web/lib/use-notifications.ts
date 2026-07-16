'use client';

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import {
  NOTIFICATION_EVENTS,
  type NotificationCreatedEvent,
  type NotificationView,
} from '@healthflow/shared-types';
import { api } from './api';
import { API_URL } from './config';

const QUERY_KEY = ['notifications'];

/**
 * Notificaciones in-app: carga inicial con TanStack Query (que de paso
 * sincroniza recordatorios de "cita próxima" en el servidor — sin cron, ver
 * plan) + poll cada 60s + suscripción WebSocket para verlas llegar al
 * instante mientras la pestaña está abierta.
 */
export function useNotifications(token: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.notifications(token),
    enabled: !!token,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!token) return;
    const socket: Socket = io(`${API_URL}/notifications`, {
      auth: { token },
      transports: ['websocket'],
    });

    socket.on(NOTIFICATION_EVENTS.NEW, (event: NotificationCreatedEvent) => {
      queryClient.setQueryData<NotificationView[]>(QUERY_KEY, (prev) =>
        prev ? [event.notification, ...prev] : [event.notification],
      );
    });

    return () => {
      socket.disconnect();
    };
  }, [token, queryClient]);

  const markRead = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(token, id),
    onMutate: (id) => {
      queryClient.setQueryData<NotificationView[]>(QUERY_KEY, (prev) =>
        prev?.map((n) => (n.id === id ? { ...n, leidaAt: new Date().toISOString() } : n)),
      );
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => api.markAllNotificationsRead(token),
    onMutate: () => {
      queryClient.setQueryData<NotificationView[]>(QUERY_KEY, (prev) =>
        prev?.map((n) => (n.leidaAt ? n : { ...n, leidaAt: new Date().toISOString() })),
      );
    },
  });

  return { ...query, markRead, markAllRead };
}
