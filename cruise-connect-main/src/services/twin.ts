/**
 * Hito 5.4.4 — cliente Twin para Torre de Control.
 * Lee snapshots del Digital Twin (read-only desde el frontend).
 */

const TWIN_URL = (import.meta.env.VITE_TWIN_URL as string | undefined)?.replace(/\/$/, '');

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

export interface TwinSnapshot {
  timestamp: string;
  env: string;
  lockers: TwinLocker[];
  drivers: TwinDriver[];
  requests: Array<{ id: number; phase: string; created_at: string }>;
  aggregates: TwinAggregates;
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
