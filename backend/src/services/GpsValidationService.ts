import { db } from '../db/database';
import { logger } from '../utils/logger';
import { config } from '../config/env';

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (x: number) => (x * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_M * 2 * Math.asin(Math.sqrt(a));
}

export type GpsAnomaly = 'CLOCK_DRIFT' | 'SPEED';

export interface GpsValidationResult {
    ok: boolean;
    anomaly?: GpsAnomaly;
    reason?: string;
}

/**
 * Validates a GPS position for anti-spoofing and records it in gps_positions.
 * Checks: clock drift (device timestamp vs server) + speed (vs last known position).
 * Returns { ok: false } and logs a warning if an anomaly is detected — caller decides
 * whether to drop or allow the position.
 */
export async function validateAndRecord(
    userId: number,
    lat: number,
    lon: number,
    deviceTsMs?: number | null,
): Promise<GpsValidationResult> {
    const serverTsMs = Date.now();

    // ── Clock drift check ──────────────────────────────────────────────────
    if (deviceTsMs != null) {
        const driftMs = Math.abs(serverTsMs - deviceTsMs);
        if (driftMs > config.gpsClockDriftMaxSec * 1000) {
            logger.warn(
                { userId, driftSec: Math.round(driftMs / 1000), maxSec: config.gpsClockDriftMaxSec },
                'GPS clock drift anomaly — position dropped'
            );
            return { ok: false, anomaly: 'CLOCK_DRIFT', reason: `drift ${Math.round(driftMs / 1000)}s` };
        }
    }

    // ── Speed check (last known position) ─────────────────────────────────
    const { rows } = await db.query(
        `SELECT lat, lon, server_ts FROM gps_positions
         WHERE user_id = $1 ORDER BY server_ts DESC LIMIT 1`,
        [userId]
    );

    if (rows.length > 0) {
        const prev = rows[0];
        const distM = haversineMeters(prev.lat, prev.lon, lat, lon);
        const dtSec = (serverTsMs - new Date(prev.server_ts).getTime()) / 1000;
        if (dtSec > 0.5) { // ignore sub-second intervals (same burst)
            const speedKmh = (distM / 1000) / (dtSec / 3600);
            if (speedKmh > config.gpsSpeedMaxKmh) {
                logger.warn(
                    { userId, speedKmh: Math.round(speedKmh), distM: Math.round(distM), dtSec: Math.round(dtSec) },
                    'GPS speed anomaly — position dropped'
                );
                return { ok: false, anomaly: 'SPEED', reason: `${Math.round(speedKmh)} km/h` };
            }
        }
    }

    // ── Record valid position ──────────────────────────────────────────────
    await db.query(
        `INSERT INTO gps_positions (user_id, lat, lon, device_ts, server_ts)
         VALUES ($1, $2, $3, $4, NOW())`,
        [userId, lat, lon, deviceTsMs != null ? new Date(deviceTsMs).toISOString() : null]
    ).catch(err => logger.error({ err, userId }, 'Failed to record gps_position'));

    return { ok: true };
}

/**
 * Returns the straight-line distance (metres) between a driver's last known
 * GPS position and the given client coordinates.
 * Returns null if no GPS position is recorded yet for this driver.
 */
export async function distanceToDriverMeters(
    driverId: number,
    clientLat: number,
    clientLon: number,
): Promise<number | null> {
    const { rows } = await db.query(
        `SELECT lat, lon FROM gps_positions
         WHERE user_id = $1 ORDER BY server_ts DESC LIMIT 1`,
        [driverId]
    );
    if (rows.length === 0) return null;
    return haversineMeters(rows[0].lat, rows[0].lon, clientLat, clientLon);
}
