/**
 * Hito 4.2.3 — Politica de caching de React Query por dominio.
 *
 * Cada uso de useQuery debe especificar el queryKey y, opcionalmente,
 * extender estas opciones segun el tipo de dato:
 *
 *   STATIC_QUERY  — datos casi inmutables (lockers, configuracion):
 *                   staleTime 5 min, gcTime 30 min.
 *   DYNAMIC_QUERY — datos vivos (solicitudes, posiciones): staleTime 10s
 *                   y se invalidan eagerly via socket.io desde el resto
 *                   del codigo (queryClient.invalidateQueries).
 *   USER_QUERY    — datos de perfil del usuario: staleTime 1 min,
 *                   refetch al focusear ventana.
 */
import type { UseQueryOptions } from '@tanstack/react-query';

export const QK = {
  lockers: ['lockers'] as const,
  notifications: ['notifications'] as const,
  pendingRequests: ['requests', 'pending'] as const,
  driverPickups: ['requests', 'driver-pickups'] as const,
  clientMine: ['requests', 'mine'] as const,
  payments: ['payments'] as const,
  metrics: ['metrics'] as const,
  user: (id?: number) => (id != null ? ['user', id] : ['user']) as const,
};

export const STATIC_QUERY: Partial<UseQueryOptions> = {
  staleTime: 5 * 60 * 1000,
  gcTime: 30 * 60 * 1000,
  refetchOnWindowFocus: false,
};

export const DYNAMIC_QUERY: Partial<UseQueryOptions> = {
  staleTime: 10 * 1000,
  gcTime: 5 * 60 * 1000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: true,
};

export const USER_QUERY: Partial<UseQueryOptions> = {
  staleTime: 60 * 1000,
  gcTime: 10 * 60 * 1000,
  refetchOnWindowFocus: true,
};
