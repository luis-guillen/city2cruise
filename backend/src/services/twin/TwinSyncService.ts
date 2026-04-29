/**
 * Hito 5.4.3 — Telemetría en tiempo real backend → Digital Twin.
 *
 * Cliente fire-and-forget que empuja eventos al twin cuando ocurren
 * cambios relevantes en el backend. El backend NO debe esperar al twin
 * (si está caído seguimos funcionando), sólo loguea el fallo.
 *
 * Protección: si TWIN_URL no está definido, todas las llamadas son no-op.
 */
import { logger } from '../../utils/logger';

type TwinEventType =
    | 'locker.status_changed'
    | 'driver.position_changed'
    | 'driver.status_changed'
    | 'request.created'
    | 'request.assigned'
    | 'request.deposited'
    | 'request.completed'
    | 'request.cancelled';

interface TwinEvent {
    event_type: TwinEventType;
    timestamp: string;
    payload: Record<string, unknown>;
}

const TWIN_URL = process.env.TWIN_URL;
const TWIN_INTERNAL_KEY = process.env.TWIN_INTERNAL_KEY;
const TWIN_TIMEOUT_MS = Number(process.env.TWIN_TIMEOUT_MS || '2000');

let consecutiveFailures = 0;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_RESET_MS = 30_000;
let circuitOpenedAt: number | null = null;

/**
 * Empuja un evento al twin. Fire-and-forget, no espera respuesta.
 * Si el circuito está abierto (>=5 fallos consecutivos), se ignora la
 * llamada hasta que pasen 30s y se intenta de nuevo.
 */
export async function syncEvent(event: TwinEvent): Promise<void> {
    if (!TWIN_URL) return; // disabled

    // Circuit breaker
    if (circuitOpenedAt !== null) {
        if (Date.now() - circuitOpenedAt < CIRCUIT_BREAKER_RESET_MS) {
            return; // skip, circuit is open
        }
        // try to recover
        circuitOpenedAt = null;
        consecutiveFailures = 0;
    }

    try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), TWIN_TIMEOUT_MS);

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (TWIN_INTERNAL_KEY) {
            headers['X-Internal-Key'] = TWIN_INTERNAL_KEY;
        }

        const r = await fetch(`${TWIN_URL.replace(/\/$/, '')}/sync`, {
            method: 'POST',
            headers,
            body: JSON.stringify(event),
            signal: controller.signal,
        });
        clearTimeout(t);

        if (!r.ok) {
            consecutiveFailures++;
            logger.warn({ event_type: event.event_type, status: r.status }, 'twin_sync_failed');
        } else {
            consecutiveFailures = 0;
        }
    } catch (err) {
        consecutiveFailures++;
        logger.warn({ event_type: event.event_type, err: (err as Error).message }, 'twin_sync_error');
    }

    if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD && circuitOpenedAt === null) {
        circuitOpenedAt = Date.now();
        logger.error({ consecutiveFailures }, 'twin_sync_circuit_open');
    }
}

// ─── Helpers tipados por evento ──────────────────────────────────────────

export function syncLockerStatus(lockerId: number, status: string, occupancyPct?: number) {
    return syncEvent({
        event_type: 'locker.status_changed',
        timestamp: new Date().toISOString(),
        payload: { locker_id: lockerId, status, ...(occupancyPct !== undefined ? { occupancy_pct: occupancyPct } : {}) },
    });
}

export function syncDriverPosition(driverId: number, latitude: number, longitude: number) {
    return syncEvent({
        event_type: 'driver.position_changed',
        timestamp: new Date().toISOString(),
        payload: { driver_id: driverId, latitude, longitude },
    });
}

export function syncDriverStatus(driverId: number, status: 'offline' | 'available' | 'busy' | 'breaking') {
    return syncEvent({
        event_type: 'driver.status_changed',
        timestamp: new Date().toISOString(),
        payload: { driver_id: driverId, status },
    });
}

export function syncRequestCreated(requestId: number, clientId: number, lockerId?: number) {
    return syncEvent({
        event_type: 'request.created',
        timestamp: new Date().toISOString(),
        payload: { request_id: requestId, client_id: clientId, ...(lockerId !== undefined ? { locker_id: lockerId } : {}) },
    });
}

export function syncRequestAssigned(requestId: number, driverId: number) {
    return syncEvent({
        event_type: 'request.assigned',
        timestamp: new Date().toISOString(),
        payload: { request_id: requestId, driver_id: driverId },
    });
}

export function syncRequestDeposited(requestId: number) {
    return syncEvent({
        event_type: 'request.deposited',
        timestamp: new Date().toISOString(),
        payload: { request_id: requestId },
    });
}

export function syncRequestCompleted(requestId: number) {
    return syncEvent({
        event_type: 'request.completed',
        timestamp: new Date().toISOString(),
        payload: { request_id: requestId },
    });
}

export function syncRequestCancelled(requestId: number, reason?: string) {
    return syncEvent({
        event_type: 'request.cancelled',
        timestamp: new Date().toISOString(),
        payload: { request_id: requestId, ...(reason ? { reason } : {}) },
    });
}

// Para tests: exporta estado interno
export function _resetCircuitForTests(): void {
    consecutiveFailures = 0;
    circuitOpenedAt = null;
}
