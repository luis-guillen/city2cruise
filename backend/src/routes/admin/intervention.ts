import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../../auth/middleware';
import { db } from '../../db/database';
import { cancelCascade } from '../../services/GeoDispatchService';
import { acceptRequest } from '../../services/RequestService';
import { reassignRequest } from '../../services/ReassignmentService';
import { syncRequestCancelled } from '../../services/twin/TwinSyncService';
import { sendError, ServiceError } from '../../utils/errors';
import { sanitizeForSocket } from '../../utils/dto';
import { emitEvent } from '../../sockets/io';

const interventionRouter = Router();

const cancelSchema = z.object({
    requestId: z.coerce.number().int().positive(),
    reason: z.string().trim().min(3).max(120).default('manual_override'),
});

const forceAssignSchema = z.object({
    requestId: z.coerce.number().int().positive(),
    driverId: z.coerce.number().int().positive(),
});

const rebalanceSchema = z.object({
    requestId: z.coerce.number().int().positive(),
    newCandidateIds: z.array(z.coerce.number().int().positive()).min(1),
});

interventionRouter.use(authMiddleware, requireRole('ADMIN'));

interventionRouter.post('/cancel', async (req, res) => {
    const parsed = cancelSchema.safeParse(req.body);
    if (!parsed.success) {
        return sendError(res, 400, 'BAD_REQUEST', 'Payload inválido');
    }

    const { requestId, reason } = parsed.data;
    const adminId = req.user!.id;
    const now = new Date().toISOString();
    try {
        const { rows: [current] } = await db.query<{
            id: number;
            status: string;
            locker_id: number | null;
        }>(
            'SELECT id, status, locker_id FROM pickup_requests WHERE id = $1',
            [requestId],
        );

        if (!current) {
            return sendError(res, 404, 'NOT_FOUND', 'Pedido no encontrado');
        }

        if (!['REQUESTED', 'CONFIRMATION_PENDING'].includes(current.status)) {
            return sendError(res, 409, 'CONFLICT', 'Solo se permiten cancelaciones manuales antes de iniciar la recogida');
        }

        await db.query(
            `UPDATE pickup_requests
             SET status = 'CANCELLED',
                 driver_id = NULL,
                 handshake_code = NULL,
                 handshake_expires_at = NULL,
                 updated_at = $1
             WHERE id = $2`,
            [now, requestId],
        );

        if (current.locker_id != null) {
            await db.query(
                `UPDATE lockers
                 SET is_occupied = FALSE,
                     current_request_id = NULL,
                     access_code = NULL,
                     updated_at = $1
                 WHERE id = $2`,
                [now, current.locker_id],
            );
        }

        cancelCascade(requestId);
        await syncRequestCancelled(requestId, reason).catch(() => {});
        emitEvent('request:updated', { id: requestId, status: 'CANCELLED', reason, manualIntervention: true });

        return res.json({ ok: true, requestId, status: 'CANCELLED' });
    } catch (err) {
        return sendError(res, 500, 'INTERNAL_ERROR', 'Error cancelando request');
    }
});

interventionRouter.post('/force-assign', async (req, res) => {
    const parsed = forceAssignSchema.safeParse(req.body);
    if (!parsed.success) {
        return sendError(res, 400, 'BAD_REQUEST', 'Payload inválido');
    }

    const { requestId, driverId } = parsed.data;
    const { rows: [driver] } = await db.query<{ id: number; name: string }>(
        `SELECT id, name
         FROM users
         WHERE id = $1 AND role = 'DRIVER'`,
        [driverId],
    );

    if (!driver) {
        return sendError(res, 404, 'NOT_FOUND', 'Conductor no encontrado');
    }

    try {
        const { dto } = await acceptRequest({
            requestId: String(requestId),
            driverId,
            driverName: driver.name,
        });
        emitEvent('request:updated', sanitizeForSocket(dto));
        return res.json({ ok: true, request: sanitizeForSocket(dto) });
    } catch (err) {
        if (err instanceof ServiceError) {
            return sendError(res, err.status, err.code, err.message);
        }
        throw err;
    }
});

interventionRouter.post('/rebalance', async (req, res) => {
    const parsed = rebalanceSchema.safeParse(req.body);
    if (!parsed.success) {
        return sendError(res, 400, 'BAD_REQUEST', 'Payload inválido');
    }

    const result = await reassignRequest(parsed.data);
    return res.json(result);
});

export default interventionRouter;
