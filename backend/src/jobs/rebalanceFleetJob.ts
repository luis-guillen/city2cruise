/**
 * rebalanceFleetJob — Sprint 3.F.3 (AC#2 Hito 3.5)
 *
 * Periodic job that re-evaluates driver assignments for stale REQUESTED pickups.
 * Runs every 60 s (configurable via REBALANCE_INTERVAL_MS) to catch demand shifts
 * not covered by the initial cascade — e.g., when a cruise manifest is updated
 * after drivers have already been notified.
 *
 * Flow:
 *   1. Load all pickup_requests WHERE status = 'REQUESTED'
 *   2. Build the current StateTensor (RL telemetry pipeline)
 *   3. Call getRLDriverRanking() to get the RL-ranked driver list
 *   4. Emit 'dispatch:rebalance:suggested' so any interested service or admin
 *      dashboard can log or act on the re-evaluated ranking
 *   5. If a request has been REQUESTED for > STALE_THRESHOLD_MS with no driver
 *      accepting, emit 'request:stale' to the originating client
 *
 * The job is advisory — it does NOT reassign or cancel requests.
 * Actual assignment remains in the cascade flow (GeoDispatchService).
 */

import { db } from '../db/database';
import { logger } from '../utils/logger';
import { buildStateTensor } from '../services/telemetry/StateFusion';
import { getRLDriverRanking } from '../services/RLDispatchService';
import { emitEvent, emitToUser } from '../sockets/io';

const REBALANCE_INTERVAL_MS =
    parseInt(process.env.REBALANCE_INTERVAL_MS || '60000', 10);

// Pickups waiting longer than this without a driver are considered stale
const STALE_THRESHOLD_MS =
    parseInt(process.env.REBALANCE_STALE_THRESHOLD_MS || '180000', 10); // 3 min

interface StalePendingRequest {
    id: number;
    clientId: number;
    createdAt: Date;
    pickupLocation: string;
}

// ── Core rebalance logic ───────────────────────────────────────────────────────

export async function runRebalanceJob(): Promise<void> {
    const { rows } = await db.query<StalePendingRequest>(`
        SELECT id,
               client_id   AS "clientId",
               created_at  AS "createdAt",
               pickup_location AS "pickupLocation"
        FROM pickup_requests
        WHERE status = 'REQUESTED'
        ORDER BY created_at ASC
    `);

    if (rows.length === 0) {
        logger.debug('[REBALANCE] No pending requests — skipping');
        return;
    }

    logger.info({ count: rows.length }, '[REBALANCE] Re-evaluating pending requests');

    // Build state tensor and get RL ranking (no-op when RL disabled or service down)
    const [tensor, rlRankings] = await Promise.all([
        buildStateTensor().catch(() => null),
        getRLDriverRanking().catch(() => []),
    ]);

    // Emit rebalance suggestion so admin dashboards / control tower can react
    if (rlRankings.length > 0) {
        emitEvent('dispatch:rebalance:suggested', {
            pendingCount: rows.length,
            rlRankings,
            evaluatedAt: new Date().toISOString(),
        });
        logger.info(
            { pendingRequests: rows.length, rlDrivers: rlRankings.length },
            '[REBALANCE] RL re-rank emitted',
        );
    }

    // Notify clients whose requests have been waiting beyond the stale threshold
    const now = Date.now();
    for (const req of rows) {
        const waitMs = now - new Date(req.createdAt).getTime();
        if (waitMs > STALE_THRESHOLD_MS) {
            emitToUser(req.clientId, 'request:stale', {
                requestId: req.id,
                waitMs,
                message: 'Buscando conductor activamente, por favor espera',
            });
            logger.info(
                { requestId: req.id, clientId: req.clientId, waitMs },
                '[REBALANCE] Stale request — client notified',
            );
        }
    }
}

// ── Scheduler ──────────────────────────────────────────────────────────────────

let _interval: NodeJS.Timeout | null = null;

export function startRebalanceScheduler(): void {
    if (_interval) return;
    _interval = setInterval(() => {
        runRebalanceJob().catch((err) =>
            logger.error({ err }, '[REBALANCE] Job error'),
        );
    }, REBALANCE_INTERVAL_MS);

    // Run once immediately so the first cycle doesn't wait a full interval
    runRebalanceJob().catch((err) =>
        logger.error({ err }, '[REBALANCE] Initial run error'),
    );

    logger.info(
        { intervalMs: REBALANCE_INTERVAL_MS, staleThresholdMs: STALE_THRESHOLD_MS },
        '[REBALANCE] Fleet rebalance scheduler started',
    );
}

export function stopRebalanceScheduler(): void {
    if (_interval) {
        clearInterval(_interval);
        _interval = null;
    }
}
