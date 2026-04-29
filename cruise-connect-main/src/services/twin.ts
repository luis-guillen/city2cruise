/**
 * Hito 5.4.4 — cliente Twin para Torre de Control.
 * Lee snapshots del Digital Twin (read-only desde el frontend).
 */
import { socket } from '@/socket';

const TWIN_URL = (import.meta.env.VITE_TWIN_URL as string | undefined)?.replace(/\/$/, '');
const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:9000/api';

export interface TwinAggregates {
  lockers_total: number;
  lockers_free: number;
  lockers_occupied: number;
  lockers_out: number;
  drivers_total: number;
  drivers_online: number;
  drivers_available: number;
  requests_active: number;
  avg_match_seconds_15m: number;
}

export interface TwinLocker {
  id: number;
  label: string;
  latitude: number;
  longitude: number;
  status: 'free' | 'reserved' | 'occupied' | 'out_of_service';
  occupancy_pct: number;
  last_change_at: string;
}

export interface TwinDriver {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  status: 'offline' | 'available' | 'busy' | 'breaking';
  current_request_id?: number | null;
  last_seen_at: string;
}

export interface TwinRequest {
  id: number;
  client_id?: number;
  locker_id?: number | null;
  driver_id?: number | null;
  phase: string;
  created_at: string;
  last_event_at?: string;
}

export interface TwinSnapshot {
  timestamp: string;
  env: string;
  lockers: TwinLocker[];
  drivers: TwinDriver[];
  requests: TwinRequest[];
  aggregates: TwinAggregates;
}

export interface RLRankingEntry {
  driverId: number;
  score: number;
  rank: number;
}

export interface RLRankingUpdate {
  requestId: number;
  rankings: RLRankingEntry[];
  modelVersion?: string;
  inferenceMs?: number;
}

function ensureUrl(): string {
  if (!TWIN_URL) {
    throw new Error('VITE_TWIN_URL no está definido. Ver envs/*.env.example');
  }
  return TWIN_URL;
}

export async function fetchTwinSnapshot(): Promise<TwinSnapshot> {
  const r = await fetch(`${ensureUrl()}/state`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`twin /state ${r.status}`);
  return r.json() as Promise<TwinSnapshot>;
}

export async function fetchTwinAggregates(): Promise<TwinAggregates> {
  const r = await fetch(`${ensureUrl()}/state/aggregates`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`twin /state/aggregates ${r.status}`);
  return r.json() as Promise<TwinAggregates>;
}

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function interveneCancel(requestId: number, reason: string): Promise<void> {
  const r = await fetch(`${API_URL}/admin/intervention/cancel`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ requestId, reason }),
  });
  if (!r.ok) throw new Error(`admin intervention cancel ${r.status}`);
}

export async function interveneForceAssign(requestId: number, driverId: number): Promise<void> {
  const r = await fetch(`${API_URL}/admin/intervention/force-assign`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ requestId, driverId }),
  });
  if (!r.ok) throw new Error(`admin intervention force-assign ${r.status}`);
}

export function subscribeRLRankings(onUpdate: (update: RLRankingUpdate) => void): () => void {
  const token = localStorage.getItem('token');
  if (token) {
    socket.auth = { token };
    if (!socket.connected) socket.connect();
  }

  const handler = (payload: RLRankingUpdate) => onUpdate(payload);
  socket.on('rl:rankings', handler);
  return () => {
    socket.off('rl:rankings', handler);
  };
}
