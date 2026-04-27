import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/database';
import { authMiddleware, requireRole } from '../auth/middleware';
import { sendError } from '../utils/errors';
import { getAuditTrail } from '../services/AuditService';
import { getActiveDrivers } from '../sockets/io';

const adminRouter = Router();

// Endpoint para obtener todos los usuarios con sus estadísticas
adminRouter.get('/users', authMiddleware, requireRole('ADMIN'), async (req, res) => {
    try {
        const { rows: users } = await db.query(`
            SELECT
                u.id, u.name, u.email, u.role, u.created_at,
                (SELECT COUNT(*) FROM pickup_requests WHERE client_id = u.id)::int as total_requests,
                (SELECT COUNT(*) FROM pickup_requests WHERE driver_id = u.id AND status = 'DEPOSITED')::int as deposited_count,
                (SELECT COUNT(*) FROM pickup_requests WHERE driver_id = u.id AND status = 'PICKED_UP')::int as picked_up_count
            FROM users u
            WHERE u.role != 'ADMIN'
            ORDER BY u.created_at DESC
        `);

        res.json(users);
    } catch (error) {
        console.error('[ADMIN] Error fetching users:', error);
        sendError(res, 500, 'INTERNAL_ERROR', 'Error fetching users');
    }
});

// Endpoint para borrar un usuario
adminRouter.delete('/users/:id', authMiddleware, requireRole('ADMIN'), async (req, res) => {
    try {
        const targetId = Number(req.params.id);

        if (isNaN(targetId)) {
            return sendError(res, 400, 'BAD_REQUEST', 'ID inválido');
        }

        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            const { rows: [user] } = await client.query('SELECT id, role FROM users WHERE id = $1', [targetId]);

            if (!user) {
                await client.query('ROLLBACK');
                return sendError(res, 404, 'NOT_FOUND', 'Usuario no encontrado');
            }
            if (user.role === 'ADMIN') {
                await client.query('ROLLBACK');
                return sendError(res, 403, 'FORBIDDEN', 'No se puede eliminar a otro administrador');
            }

            if (user.role === 'CLIENT') {
                await client.query(`
                    UPDATE lockers 
                    SET is_occupied = FALSE, current_request_id = NULL, access_code = NULL 
                    WHERE current_request_id IN (SELECT id FROM pickup_requests WHERE client_id = $1)
                `, [targetId]);

                await client.query('DELETE FROM pickup_requests WHERE client_id = $1', [targetId]);
            }

            if (user.role === 'DRIVER') {
                await client.query('UPDATE pickup_requests SET driver_id = NULL WHERE driver_id = $1', [targetId]);
            }

            await client.query('DELETE FROM users WHERE id = $1', [targetId]);
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        res.json({ success: true, message: 'Usuario eliminado correctamente' });
    } catch (error) {
        console.error('[ADMIN] Error deleting user:', error);
        sendError(res, 500, 'INTERNAL_ERROR', 'Error eliminando usuario');
    }
});

// ── GET /admin/metrics/throughput ────────────────────────────────────────────
adminRouter.get('/metrics/throughput', authMiddleware, requireRole('ADMIN'), async (req, res) => {
    try {
        const { rows: [{ n: total_requests }] } = await db.query('SELECT COUNT(*)::int as n FROM pickup_requests');

        const { rows: statusRows } = await db.query(`
            SELECT status, COUNT(*)::int as n FROM pickup_requests GROUP BY status
        `);
        const by_status: Record<string, number> = {
            REQUESTED: 0, CONFIRMATION_PENDING: 0, IN_PROGRESS: 0, DEPOSITED: 0, PICKED_UP: 0
        };
        for (const row of statusRows) {
            if (row.status in by_status) by_status[row.status] = row.n;
        }

        const { rows: [lockerStats] } = await db.query(`
            SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE is_occupied = TRUE)::int as occupied FROM lockers
        `);
        const lockers_total     = lockerStats.total;
        const lockers_occupied  = lockerStats.occupied ?? 0;
        const lockers_available = lockers_total - lockers_occupied;
        const occupancy_rate    = lockers_total > 0
            ? Math.round((lockers_occupied / lockers_total) * 100 * 100) / 100
            : 0;

        const { rows: [rotationRow] } = await db.query(`
            SELECT AVG(usage_count)::float as avg FROM (
                SELECT locker_id, COUNT(*) as usage_count
                FROM pickup_requests
                WHERE locker_id IS NOT NULL AND updated_at::date = CURRENT_DATE
                GROUP BY locker_id
            ) sub
        `);
        const avg_rotation_today = rotationRow.avg ?? 0;

        res.json({
            total_requests,
            by_status,
            lockers_total,
            lockers_occupied,
            lockers_available,
            occupancy_rate,
            avg_rotation_today
        });
    } catch (error) {
        console.error('[ADMIN] metrics/throughput error:', error);
        sendError(res, 500, 'INTERNAL_ERROR', 'Error calculando métricas de throughput');
    }
});

// ── GET /admin/metrics/timing ─────────────────────────────────────────────────
adminRouter.get('/metrics/timing', authMiddleware, requireRole('ADMIN'), async (req, res) => {
    try {
        const { rows: [avgAssignment] } = await db.query(`
            SELECT AVG(EXTRACT(EPOCH FROM (a.created_at::timestamptz - r.created_at::timestamptz)))::float as avg_secs
            FROM audit_events a
            JOIN audit_events r ON a.request_id = r.request_id
            WHERE a.event_type = 'ASSIGNED' AND r.event_type = 'REQUESTED'
        `);

        const { rows: [avgDelivery] } = await db.query(`
            SELECT AVG(EXTRACT(EPOCH FROM (d.created_at::timestamptz - a.created_at::timestamptz)))::float as avg_secs
            FROM audit_events d
            JOIN audit_events a ON d.request_id = a.request_id
            WHERE d.event_type = 'DEPOSITED' AND a.event_type = 'ASSIGNED'
        `);

        const { rows: [avgTotal] } = await db.query(`
            SELECT AVG(EXTRACT(EPOCH FROM (p.created_at::timestamptz - r.created_at::timestamptz)))::float as avg_secs
            FROM audit_events p
            JOIN audit_events r ON p.request_id = r.request_id
            WHERE p.event_type = 'PICKED_UP' AND r.event_type = 'REQUESTED'
        `);

        const { rows: [{ n: requests_today }] } = await db.query(`
            SELECT COUNT(*)::int as n FROM pickup_requests WHERE created_at::date = CURRENT_DATE
        `);

        const { rows: [{ n: requests_this_week }] } = await db.query(`
            SELECT COUNT(*)::int as n FROM pickup_requests WHERE created_at >= NOW() - INTERVAL '7 days'
        `);

        const round2 = (v: number | null) => v != null ? Math.round(v * 100) / 100 : null;

        res.json({
            avg_assignment_time_seconds: round2(avgAssignment.avg_secs),
            avg_delivery_time_seconds:   round2(avgDelivery.avg_secs),
            avg_total_time_seconds:      round2(avgTotal.avg_secs),
            requests_today,
            requests_this_week
        });
    } catch (error) {
        console.error('[ADMIN] metrics/timing error:', error);
        sendError(res, 500, 'INTERNAL_ERROR', 'Error calculando métricas de timing');
    }
});

// ── GET /admin/fleet-status ───────────────────────────────────────────────────
adminRouter.get('/fleet-status', authMiddleware, requireRole('ADMIN'), async (req, res) => {
    try {
        const { rows: [{ n: total_drivers }] } = await db.query(
            "SELECT COUNT(*)::int as n FROM users WHERE role = 'DRIVER'"
        );

        const active_drivers = getActiveDrivers().length;

        const { rows: [{ n: on_delivery }] } = await db.query(`
            SELECT COUNT(DISTINCT driver_id)::int as n FROM pickup_requests
            WHERE status = 'IN_PROGRESS' AND driver_id IS NOT NULL
        `);

        res.json({
            total_drivers,
            active_drivers,
            on_delivery,
            available: total_drivers - on_delivery
        });
    } catch (error) {
        console.error('[ADMIN] fleet-status error:', error);
        sendError(res, 500, 'INTERNAL_ERROR', 'Error obteniendo estado de flota');
    }
});

// ── GET /admin/audit-trail/:requestId ─────────────────────────────────────────
adminRouter.get('/audit-trail/:requestId', authMiddleware, requireRole('ADMIN'), async (req, res) => {
    const requestId = Number(req.params.requestId);
    if (isNaN(requestId)) return sendError(res, 400, 'BAD_REQUEST', 'requestId inválido');

    try {
        const events = await getAuditTrail(requestId);
        res.json(events);
    } catch (error) {
        console.error('[ADMIN] audit-trail/:requestId error:', error);
        sendError(res, 500, 'INTERNAL_ERROR', 'Error obteniendo audit trail');
    }
});

// ── GET /admin/audit-trail ────────────────────────────────────────────────────
const paginationSchema = z.object({
    page:  z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(500).default(100)
});

adminRouter.get('/audit-trail', authMiddleware, requireRole('ADMIN'), async (req, res) => {
    try {
        const { page, limit } = paginationSchema.parse(req.query);
        const offset = (page - 1) * limit;

        const { rows: events } = await db.query(
            'SELECT * FROM audit_events ORDER BY created_at DESC LIMIT $1 OFFSET $2',
            [limit, offset]
        );

        const { rows: [{ n: total }] } = await db.query('SELECT COUNT(*)::int as n FROM audit_events');

        res.json({ page, limit, total, events });
    } catch (error) {
        console.error('[ADMIN] audit-trail error:', error);
        sendError(res, 500, 'INTERNAL_ERROR', 'Error obteniendo audit trail');
    }
});

// ── GET /admin/payments — lista de transacciones con datos del pedido ────────
adminRouter.get('/payments', authMiddleware, requireRole('ADMIN'), async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string || '50', 10)));
        const offset = (page - 1) * limit;

        const { rows } = await db.query(
            `SELECT
                p.id, p.request_id, p.client_id, p.amount_cents, p.currency, p.status,
                p.stripe_payment_intent_id, p.captured_at, p.refunded_at, p.refund_reason,
                p.created_at, p.updated_at,
                pr.pickup_location, pr.package_size,
                u.name AS client_name, u.email AS client_email
             FROM payments p
             JOIN pickup_requests pr ON p.request_id = pr.id
             JOIN users u ON p.client_id = u.id
             ORDER BY p.created_at DESC
             LIMIT $1 OFFSET $2`,
            [limit, offset],
        );

        const { rows: [{ n: total }] } = await db.query('SELECT COUNT(*)::int as n FROM payments');

        res.json({ page, limit, total, payments: rows });
    } catch (error) {
        console.error('[ADMIN] payments error:', error);
        sendError(res, 500, 'INTERNAL_ERROR', 'Error obteniendo pagos');
    }
});

export default adminRouter;
