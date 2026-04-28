/**
 * Internal API — consumed exclusively by the RL microservice (Sprint 3.E).
 * All routes require the X-Internal-Key header matching INTERNAL_API_KEY env var.
 * Not mounted under /v1 — lives at /api/internal/* to signal it is not a public API.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import { sendError } from '../utils/errors';
import { logger } from '../utils/logger';
import {
    buildStateTensor,
    saveSnapshot,
    getLatestSnapshot,
} from '../services/telemetry/StateFusion';

const internalRouter = Router();

// ─── Auth guard ───────────────────────────────────────────────────────────────

function internalAuth(req: Request, res: Response, next: NextFunction): void {
    const key = req.headers['x-internal-key'];
    if (!key || key !== config.internalApiKey) {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing X-Internal-Key' });
        return;
    }
    next();
}

internalRouter.use(internalAuth);

// ─── GET /api/internal/state-tensor ──────────────────────────────────────────
//
// Query params:
//   fresh=true   (default) — rebuild the full pipeline and save a snapshot
//   fresh=false             — return the most recent persisted snapshot (cheaper)
//   save=false              — skip persisting the snapshot (useful for health checks)

internalRouter.get('/state-tensor', async (req, res) => {
    const fresh = req.query.fresh !== 'false';
    const persist = req.query.save !== 'false';

    try {
        if (!fresh) {
            const cached = await getLatestSnapshot();
            if (cached) return res.json(cached);
            // Fall through to fresh build if no snapshot exists
        }

        const tensor = await buildStateTensor();

        if (persist) {
            saveSnapshot(tensor).catch(() => {}); // fire-and-forget
        }

        res.json(tensor);
    } catch (err) {
        logger.error({ err }, '[Internal] /state-tensor generation failed');
        return sendError(res, 503, 'FUSION_ERROR', 'State tensor generation failed');
    }
});

// ─── GET /api/internal/snapshots ─────────────────────────────────────────────
// Returns recent snapshot metadata (without full JSONB payload) for monitoring.

internalRouter.get('/snapshots', async (req, res) => {
    const limit = Math.min(parseInt((req.query.limit as string) || '20', 10), 100);

    try {
        const { rows } = await (await import('../db/database')).db.query(
            `SELECT id, driver_count, active_request_count, locker_occupancy_rate, max_urgency, created_at
             FROM telemetry_state_snapshots
             ORDER BY created_at DESC
             LIMIT $1`,
            [limit],
        );
        res.json({ count: rows.length, snapshots: rows });
    } catch (err) {
        logger.error({ err }, '[Internal] /snapshots query failed');
        return sendError(res, 500, 'DB_ERROR', 'Failed to fetch snapshots');
    }
});

export default internalRouter;
