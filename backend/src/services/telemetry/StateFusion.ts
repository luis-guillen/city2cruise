/**
 * StateFusion — Sprint 3.D
 *
 * Orchestrates the full telemetry pipeline into a single, normalised "state tensor"
 * ready to be consumed by the Gym-based RL microservice (Sprint 3.E).
 *
 * Pipeline (target: < 200 ms wall-clock):
 *   1. Fetch active driver–request assignments and their recent GPS tracks
 *   2. Replay each track through GpsKalmanFilter to obtain smoothed position + velocity
 *   3. In parallel: computeDemandDensity | computeUrgency | lockerSummary | activeCount
 *   4. Compute per-driver ETA from smoothed position
 *   5. Assemble + normalise → StateTensor
 *   6. Persist snapshot to telemetry_state_snapshots (optional, fire-and-forget)
 */

import { db } from '../../db/database';
import { logger } from '../../utils/logger';
import { config } from '../../config/env';
import { GpsKalmanFilter, GpsPoint, SmoothedPoint } from './KalmanFilter';
import {
    computeDemandDensity,
    computeETA,
    computeUrgency,
    DemandCluster,
    EtaResult,
    UrgencyScore,
} from './FeatureEngineering';

// ─── Normalisation bounds from service-area viewbox ──────────────────────────
// SERVICE_AREA_VIEWBOX format: "lon_min,lat_min,lon_max,lat_max"
const [LON_MIN, LAT_MIN, LON_MAX, LAT_MAX] = config.SERVICE_AREA_VIEWBOX
    .split(',')
    .map(Number) as [number, number, number, number];

const MAX_SPEED_MPS = 30;       // 108 km/h — normalisation ceiling
const MAX_DISTANCE_M = 15_000;  // 15 km  — normalisation ceiling for ETA distance
const GPS_HISTORY_LIMIT = 20;   // recent fixes to replay per driver

function normLat(lat: number): number {
    return Math.max(0, Math.min(1, (lat - LAT_MIN) / (LAT_MAX - LAT_MIN)));
}
function normLon(lon: number): number {
    return Math.max(0, Math.min(1, (lon - LON_MIN) / (LON_MAX - LON_MIN)));
}

// ─── Public tensor types ──────────────────────────────────────────────────────

export interface DriverState {
    driverId: number;
    lat: number;
    lon: number;
    latNorm: number;    // [0,1] within service-area bbox
    lonNorm: number;
    vLat: number;       // deg/s, north-positive (Kalman estimate)
    vLon: number;       // deg/s, east-positive  (Kalman estimate)
    speedMps: number;
    speedNorm: number;  // [0,1], clipped at MAX_SPEED_MPS
    sigmaM: number;     // Kalman 1-σ position uncertainty
    eta: (EtaResult & { distanceNorm: number }) | null;
}

export interface LockerSummary {
    total: number;
    occupied: number;
    available: number;
    occupancyRate: number;  // [0,1]
}

export interface StateTensor {
    version: '1.0';
    generatedAt: number;        // Unix ms
    durationMs: number;         // pipeline wall-clock time
    drivers: DriverState[];
    demandClusters: DemandCluster[];
    urgency: UrgencyScore[];
    lockers: LockerSummary;
    activeRequestCount: number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface ActiveAssignment {
    requestId: number;
    pickupLat: number;
    pickupLon: number;
}

async function fetchAssignments(): Promise<Map<number, ActiveAssignment>> {
    const { rows } = await db.query<{
        driver_id: number;
        request_id: number;
        latitude: number;
        longitude: number;
    }>(
        `SELECT driver_id, id AS request_id, latitude, longitude
         FROM pickup_requests
         WHERE status IN ('ACCEPTED', 'CONFIRMATION_PENDING', 'IN_PROGRESS')
           AND driver_id IS NOT NULL
           AND latitude IS NOT NULL
           AND longitude IS NOT NULL`,
    );

    return new Map(rows.map(r => [
        r.driver_id,
        { requestId: r.request_id, pickupLat: r.latitude, pickupLon: r.longitude },
    ]));
}

async function fetchGpsTracks(driverIds: number[]): Promise<Map<number, GpsPoint[]>> {
    if (driverIds.length === 0) return new Map();

    const { rows } = await db.query<{
        user_id: number;
        lat: number;
        lon: number;
        server_ts: Date;
        accuracy_m: number | null;
    }>(
        `SELECT user_id, lat, lon, server_ts, accuracy_m
         FROM (
             SELECT user_id, lat, lon, server_ts, accuracy_m,
                    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY server_ts DESC) AS rn
             FROM gps_positions
             WHERE user_id = ANY($1)
               AND server_ts > NOW() - INTERVAL '10 minutes'
         ) t
         WHERE rn <= $2
         ORDER BY user_id, server_ts ASC`,
        [driverIds, GPS_HISTORY_LIMIT],
    );

    const tracks = new Map<number, GpsPoint[]>();
    for (const row of rows) {
        if (!tracks.has(row.user_id)) tracks.set(row.user_id, []);
        const ts = row.server_ts instanceof Date
            ? row.server_ts.getTime()
            : new Date(row.server_ts as unknown as string).getTime();
        tracks.get(row.user_id)!.push({
            lat: row.lat,
            lon: row.lon,
            timestamp: ts,
            accuracyM: row.accuracy_m ?? undefined,
        });
    }
    return tracks;
}

async function buildDriverStates(assignments: Map<number, ActiveAssignment>): Promise<DriverState[]> {
    const driverIds = [...assignments.keys()];
    const tracks = await fetchGpsTracks(driverIds);
    const states: DriverState[] = [];

    for (const driverId of driverIds) {
        const track = tracks.get(driverId);
        if (!track || track.length === 0) continue;

        const smoothed = GpsKalmanFilter.smoothTrack(track);
        const latest: SmoothedPoint = smoothed[smoothed.length - 1];

        const cosLat = Math.cos((latest.lat * Math.PI) / 180);
        const vLatMps = latest.vLat * 111_139;
        const vLonMps = latest.vLon * 111_139 * cosLat;
        const speedMps = Math.sqrt(vLatMps ** 2 + vLonMps ** 2);

        let eta: (EtaResult & { distanceNorm: number }) | null = null;
        const assignment = assignments.get(driverId);
        if (assignment) {
            const raw = computeETA({
                driverId,
                requestId: assignment.requestId,
                driverPosition: latest,
                pickupLat: assignment.pickupLat,
                pickupLon: assignment.pickupLon,
            });
            eta = { ...raw, distanceNorm: Math.min(1, raw.distanceM / MAX_DISTANCE_M) };
        }

        states.push({
            driverId,
            lat: latest.lat,
            lon: latest.lon,
            latNorm: normLat(latest.lat),
            lonNorm: normLon(latest.lon),
            vLat: latest.vLat,
            vLon: latest.vLon,
            speedMps,
            speedNorm: Math.min(1, speedMps / MAX_SPEED_MPS),
            sigmaM: latest.sigmaM,
            eta,
        });
    }

    return states;
}

async function buildLockerSummary(): Promise<LockerSummary> {
    const { rows } = await db.query<{ total: number; occupied: number }>(
        `SELECT
             COUNT(*)::integer                               AS total,
             COUNT(*) FILTER (WHERE is_occupied)::integer   AS occupied
         FROM lockers
         WHERE hw_status = 'ONLINE'`,
    );
    const { total, occupied } = rows[0];
    return {
        total,
        occupied,
        available: total - occupied,
        occupancyRate: total > 0 ? occupied / total : 0,
    };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a fresh state tensor by running the full telemetry pipeline.
 * Logs a warning if the pipeline exceeds the 200 ms latency budget.
 */
export async function buildStateTensor(): Promise<StateTensor> {
    const startMs = Date.now();

    const assignments = await fetchAssignments();

    const [drivers, demandClusters, urgency, lockers, countResult] = await Promise.all([
        buildDriverStates(assignments),
        computeDemandDensity(),
        computeUrgency(),
        buildLockerSummary(),
        db.query<{ count: number }>(
            `SELECT COUNT(*)::integer AS count
             FROM pickup_requests
             WHERE status NOT IN ('PICKED_UP', 'CANCELLED')`,
        ),
    ]);

    const durationMs = Date.now() - startMs;

    if (durationMs > 200) {
        logger.warn(
            { durationMs, drivers: drivers.length, clusters: demandClusters.length },
            '[StateFusion] Pipeline exceeded 200 ms latency budget',
        );
    } else {
        logger.debug(
            { durationMs, drivers: drivers.length },
            '[StateFusion] Tensor built',
        );
    }

    return {
        version: '1.0',
        generatedAt: startMs,
        durationMs,
        drivers,
        demandClusters,
        urgency,
        lockers,
        activeRequestCount: countResult.rows[0].count,
    };
}

/**
 * Persist a tensor snapshot to `telemetry_state_snapshots` for offline debugging
 * and RL training dataset generation.
 * Designed as fire-and-forget — errors are logged but not re-thrown.
 */
export async function saveSnapshot(tensor: StateTensor): Promise<void> {
    try {
        const maxUrgency = tensor.urgency.reduce((m, u) => Math.max(m, u.urgency), 0);

        await db.query(
            `INSERT INTO telemetry_state_snapshots
                 (snapshot, driver_count, active_request_count, locker_occupancy_rate, max_urgency)
             VALUES ($1, $2, $3, $4, $5)`,
            [
                JSON.stringify(tensor),
                tensor.drivers.length,
                tensor.activeRequestCount,
                tensor.lockers.occupancyRate,
                maxUrgency,
            ],
        );
    } catch (err) {
        logger.error({ err }, '[StateFusion] Failed to persist snapshot');
    }
}

/**
 * Return the most recent persisted snapshot without recomputing the pipeline.
 * Useful for cheap polling from the RL microservice between scheduled builds.
 */
export async function getLatestSnapshot(): Promise<StateTensor | null> {
    const { rows } = await db.query<{ snapshot: StateTensor }>(
        `SELECT snapshot FROM telemetry_state_snapshots ORDER BY created_at DESC LIMIT 1`,
    );
    return rows.length > 0 ? rows[0].snapshot : null;
}
