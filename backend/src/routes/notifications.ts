import { Router } from 'express';
import { db } from '../db/database';
import { authMiddleware, requireRole } from '../auth/middleware';
import { sendError } from '../utils/errors';

const notificationsRouter = Router();

// GET /notifications
notificationsRouter.get('/', authMiddleware, requireRole('CLIENT'), async (req, res) => {
    const { rows } = await db.query(`
        SELECT * FROM notifications 
        WHERE user_id = $1 
        ORDER BY created_at DESC
    `, [req.user!.id]);

    const dtos = rows.map((r: any) => ({
        id: r.id,
        userId: r.user_id,
        type: r.type,
        title: r.title,
        message: r.message,
        read: r.read === true,
        createdAt: r.created_at
    }));

    res.json(dtos);
});

// POST /notifications/:id/read
notificationsRouter.post('/:id/read', authMiddleware, requireRole('CLIENT'), async (req, res) => {
    const notifId = String(req.params.id);
    if (!/^\d+$/.test(notifId)) {
        return sendError(res, 400, 'BAD_REQUEST', 'ID inválido');
    }

    const { rowCount } = await db.query(`
        UPDATE notifications 
        SET read = TRUE 
        WHERE id = $1 AND user_id = $2
    `, [notifId, req.user!.id]);

    if (rowCount === 0) {
        return sendError(res, 404, 'NOT_FOUND', 'Notificación no encontrada');
    }

    res.json({ success: true });
});

// DELETE /notifications (Borrar todas las notificaciones del usuario)
notificationsRouter.delete('/', authMiddleware, requireRole('CLIENT'), async (req, res) => {
    await db.query('DELETE FROM notifications WHERE user_id = $1', [req.user!.id]);
    res.json({ success: true });
});

export default notificationsRouter;
