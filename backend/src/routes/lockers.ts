import { Router } from 'express';
import { db } from '../db/database';
import { authMiddleware, requireRole } from '../auth/middleware';
import { sendError, ServiceError } from '../utils/errors';
import { sanitizeForSocket } from '../utils/dto';
import { emitEvent } from '../sockets/io';
import { config } from '../config/env';
import { openLockerSchema } from '../schemas/locker.schemas';
import { validateBody } from '../middleware/validateSchema';
import * as LockerService from '../services/LockerService';
import { getLockerBreakers } from '../adapters/locker';
import { logLockerHwEvent } from '../services/AuditService';
import { logger } from '../utils/logger';

const lockersRouter = Router();

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

// POST /lockers/open (CLIENT)
lockersRouter.post('/open', authMiddleware, requireRole('CLIENT'), validateBody(openLockerSchema), async (req, res) => {
    try {
        if (config.simulateRace) await delay(50);

        const { dto } = await LockerService.openLocker({
            lockerCode: req.body.lockerCode,
            userId: req.user!.id,
            userName: req.user!.name,
        });

        emitEvent('request:updated', sanitizeForSocket(dto));
        res.json(dto);
    } catch (err) {
        if (err instanceof ServiceError) {
            return sendError(res, err.status, err.code, err.message);
        }
        throw err;
    }
});

// POST /lockers/:id/emergency-open  (ADMIN only)
lockersRouter.post('/:id/emergency-open', authMiddleware, requireRole('ADMIN'), async (req, res) => {
    const lockerId = parseInt(req.params.id as string, 10);
    if (isNaN(lockerId)) return sendError(res, 400, 'INVALID_ID', 'Locker ID must be numeric');

    const { reason } = req.body as { reason?: string };
    const actorId = req.user!.id;
    const actorName = req.user!.name;
    const clientIp = req.ip ?? 'unknown';

    // 1. Verify locker exists
    const { rows } = await db.query<{ id: number; label: string; hw_status: string }>(
        'SELECT id, label, hw_status FROM lockers WHERE id = $1',
        [lockerId],
    );
    if (rows.length === 0) return sendError(res, 404, 'NOT_FOUND', 'Locker not found');
    const locker = rows[0];

    // 2. Send open command via circuit-breaker-wrapped adapter
    const { open: openBreaker } = getLockerBreakers();
    try {
        await openBreaker.fire(String(lockerId));
    } catch (err) {
        logger.error({ err, lockerId, actorId }, 'Emergency open hardware command failed');

        // Audit even on failure — the intent must always be recorded
        logLockerHwEvent({
            lockerId,
            eventType: 'EMERGENCY_OPEN',
            actorId,
            metadata: { success: false, reason, actorName, clientIp, error: String(err) },
        }).catch(() => {});

        return sendError(res, 503, 'HW_ERROR', 'Hardware command failed — locker may need manual intervention');
    }

    // 3. If locker was OUT_OF_SERVICE, restore it to ONLINE after successful open
    if (locker.hw_status === 'OUT_OF_SERVICE') {
        await db.query("UPDATE lockers SET hw_status = 'ONLINE', updated_at = NOW() WHERE id = $1", [lockerId]);
        logLockerHwEvent({
            lockerId,
            eventType: 'MARKED_ONLINE',
            actorId,
            metadata: { reason: 'emergency_open_succeeded', actorName },
        }).catch(() => {});
    }

    // 4. Reinforced audit log — includes actor, IP, reason, and locker label
    await logLockerHwEvent({
        lockerId,
        eventType: 'EMERGENCY_OPEN',
        actorId,
        metadata: {
            success: true,
            reason: reason ?? 'unspecified',
            actorName,
            clientIp,
            lockerLabel: locker.label,
            timestamp: new Date().toISOString(),
        },
    });

    logger.warn({ lockerId, lockerLabel: locker.label, actorId, actorName, clientIp, reason }, 'EMERGENCY OPEN executed');

    res.json({
        ok: true,
        lockerId,
        lockerLabel: locker.label,
        openedAt: new Date().toISOString(),
    });
});

// GET /lockers/:id/hw-status  (ADMIN — for dashboard monitoring)
lockersRouter.get('/:id/hw-status', authMiddleware, requireRole('ADMIN'), async (req, res) => {
    const lockerId = parseInt(req.params.id as string, 10);
    if (isNaN(lockerId)) return sendError(res, 400, 'INVALID_ID', 'Locker ID must be numeric');

    const { status: statusBreaker } = getLockerBreakers();
    try {
        const hwStatus = await statusBreaker.fire(String(lockerId));
        const { rows } = await db.query(
            'SELECT id, label, hw_status, last_sync_at FROM lockers WHERE id = $1',
            [lockerId],
        );
        if (rows.length === 0) return sendError(res, 404, 'NOT_FOUND', 'Locker not found');
        res.json({ ...rows[0], hw_realtime_status: hwStatus });
    } catch (err) {
        return sendError(res, 503, 'HW_UNAVAILABLE', 'Could not reach hardware');
    }
});

export default lockersRouter;
