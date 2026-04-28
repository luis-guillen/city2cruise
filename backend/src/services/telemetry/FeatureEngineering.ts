/**
 * Feature engineering pipeline for the telemetry state tensor.
 *
 * Three feature groups:
 *   • computeDemandDensity  — spatial clustering of active requests via PostGIS ST_ClusterDBSCAN
 *   • computeETA            — dynamic arrival estimate from Kalman-filtered driver position
 *   • computeUrgency        — time-pressure score derived from cruise manifest "all-aboard" deadline
 *
 * All async functions are designed to complete in < 50 ms under normal DB load so
 * the full pipeline stays within the 200 ms latency budget.
 */

import { db } from '../../db/database';
import type { SmoothedPoint } from './KalmanFilter';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DemandCluster {
    clusterId: number;
    centroidLat: number;
    centroidLon: number;
    requestCount: number;
    /** Approximate cluster radius (equals the DBSCAN eps parameter). */
    epsM: number;
}

export interface EtaInput {
    driverId: number;
    requestId: number;
    driverPosition: SmoothedPoint;
    pickupLat: number;
    pickupLon: number;
}

export interface EtaResult {
    driverId: number;
    requestId: number;
    /** Absolute Unix ms timestamp of estimated arrival. */
    estimatedArrivalMs: number;
    distanceM: number;
    speedMps: number;
}

export interface UrgencyScore {
    cruiseId: number;
    vesselName: string;
    allAboardAt: Date;
    minutesToDeadline: number;
    /** Normalised urgency in [0, 1]. 0 = well within window, 1 = deadline now. */
    urgency: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEG_TO_M = 111_139;
const EARTH_RADIUS_M = 6_371_000;

// ─── Geometry helpers ─────────────────────────────────────────────────────────

/** Haversine great-circle distance in metres. */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δφ = toRad(lat2 - lat1);
    const Δλ = toRad(lon2 - lon1);
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Feature 1: Demand density ───────────────────────────────────────────────

/**
 * Cluster active pickup requests spatially using PostGIS ST_ClusterDBSCAN.
 * Returns one record per cluster with centroid coordinates and request count.
 *
 * @param epsM      DBSCAN search radius in metres (default 500 m)
 * @param minPts    Minimum points to form a core cluster (default 2)
 */
export async function computeDemandDensity(epsM = 500, minPts = 2): Promise<DemandCluster[]> {
    const { rows } = await db.query<{
        cluster_id: number;
        centroid_lat: number;
        centroid_lon: number;
        request_count: number;
    }>(
        `WITH clustered AS (
            SELECT
                id,
                latitude,
                longitude,
                ST_ClusterDBSCAN(pickup_location_geo, $1, $2) OVER () AS cluster_id
            FROM pickup_requests
            WHERE status IN ('REQUESTED', 'ACCEPTED', 'CONFIRMATION_PENDING')
              AND pickup_location_geo IS NOT NULL
              AND latitude IS NOT NULL
              AND longitude IS NOT NULL
         )
         SELECT
             cluster_id,
             AVG(latitude)::double precision  AS centroid_lat,
             AVG(longitude)::double precision AS centroid_lon,
             COUNT(*)::integer                AS request_count
         FROM clustered
         WHERE cluster_id IS NOT NULL
         GROUP BY cluster_id
         ORDER BY request_count DESC`,
        [epsM, minPts],
    );

    return rows.map(r => ({
        clusterId: r.cluster_id,
        centroidLat: r.centroid_lat,
        centroidLon: r.centroid_lon,
        requestCount: r.request_count,
        epsM,
    }));
}

// ─── Feature 2: ETA ──────────────────────────────────────────────────────────

/**
 * Estimate driver arrival time at a pickup location from a Kalman-smoothed position.
 *
 * Speed is derived from the filter's velocity estimate (vLat, vLon). When the driver
 * is stationary (< minSpeedMps) a conservative floor is used so ETA remains finite.
 *
 * @param minSpeedMps  Speed floor in m/s (default 2.0 ≈ 7 km/h urban minimum)
 */
export function computeETA(input: EtaInput, minSpeedMps = 2.0): EtaResult {
    const { driverPosition: d, pickupLat, pickupLon } = input;

    const distanceM = haversineM(d.lat, d.lon, pickupLat, pickupLon);

    // Convert Kalman velocity (deg/s) → m/s, accounting for longitude compression
    const cosLat = Math.cos((d.lat * Math.PI) / 180);
    const vLatMps = d.vLat * DEG_TO_M;
    const vLonMps = d.vLon * DEG_TO_M * cosLat;
    const speedMps = Math.max(Math.sqrt(vLatMps ** 2 + vLonMps ** 2), minSpeedMps);

    const etaMs = Math.round((distanceM / speedMps) * 1000);

    return {
        driverId: input.driverId,
        requestId: input.requestId,
        estimatedArrivalMs: Date.now() + etaMs,
        distanceM,
        speedMps,
    };
}

/**
 * Batch-compute ETAs for all active driver–request assignments in the database.
 * Returns one EtaResult per driver that has a current smoothed position snapshot.
 */
export async function computeBatchETA(
    smoothedPositions: Map<number, SmoothedPoint>,
    minSpeedMps = 2.0,
): Promise<EtaResult[]> {
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

    return rows.flatMap(r => {
        const pos = smoothedPositions.get(r.driver_id);
        if (!pos) return [];
        return [
            computeETA(
                { driverId: r.driver_id, requestId: r.request_id, driverPosition: pos, pickupLat: r.latitude, pickupLon: r.longitude },
                minSpeedMps,
            ),
        ];
    });
}

// ─── Feature 3: Urgency ───────────────────────────────────────────────────────

/**
 * Derive urgency scores from cruise ship "all-aboard" deadlines.
 *
 * Urgency is 0 when the deadline is `urgencyWindowMinutes` away,
 * rising linearly to 1 at the deadline, and clamped above 1.
 *
 * Only cruises in `docked` status with a future all-aboard time
 * within `urgencyWindowMinutes` are considered.
 *
 * @param urgencyWindowMinutes  Planning horizon in minutes (default 240 = 4 h)
 */
export async function computeUrgency(urgencyWindowMinutes = 240): Promise<UrgencyScore[]> {
    const { rows } = await db.query<{
        id: number;
        vessel_name: string;
        all_aboard: Date;
    }>(
        `SELECT id, vessel_name, all_aboard
         FROM cruise_manifest
         WHERE status = 'docked'
           AND all_aboard > NOW()
           AND all_aboard < NOW() + ($1::integer * INTERVAL '1 minute')
         ORDER BY all_aboard ASC`,
        [urgencyWindowMinutes],
    );

    const nowMs = Date.now();

    return rows.map(r => {
        const deadlineMs = r.all_aboard instanceof Date
            ? r.all_aboard.getTime()
            : new Date(r.all_aboard as unknown as string).getTime();

        const minutesToDeadline = (deadlineMs - nowMs) / 60_000;

        // Linear ramp: 0 at full window, 1 at deadline
        const urgency = Math.max(0, Math.min(1, 1 - minutesToDeadline / urgencyWindowMinutes));

        return {
            cruiseId: r.id,
            vesselName: r.vessel_name,
            allAboardAt: new Date(deadlineMs),
            minutesToDeadline,
            urgency,
        };
    });
}
