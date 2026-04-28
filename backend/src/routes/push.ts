import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/middleware';
import {
    saveSubscription, removeSubscription,
    getPrefs, upsertPrefs, vapidPublicKey,
} from '../services/NotificationService';
import { ServiceError } from '../utils/errors';

const router = Router();

const subscribeSchema = z.object({
    endpoint: z.string().url(),
    keys: z.object({
        p256dh: z.string().min(1),
        auth: z.string().min(1),
    }),
});

const prefsSchema = z.object({
    pushEnabled: z.boolean().optional(),
    smsEnabled: z.boolean().optional(),
    locale: z.enum(['es', 'en', 'ca']).optional(),
    phone: z.string().regex(/^\+?[0-9\s\-]{7,20}$/).nullable().optional(),
});

// GET /api/push/vapid-public-key — devuelve la clave pública VAPID (sin auth)
router.get('/vapid-public-key', (_req: Request, res: Response) => {
    res.json({ publicKey: vapidPublicKey });
});

// POST /api/push/subscribe — registra suscripción VAPID
router.post('/subscribe', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user.id;
        const parsed = subscribeSchema.safeParse(req.body);
        if (!parsed.success) throw new ServiceError(400, 'BAD_REQUEST', 'Payload de suscripción inválido');

        await saveSubscription(userId, parsed.data);
        res.json({ ok: true });
    } catch (err) { next(err); }
});

// DELETE /api/push/subscribe — elimina suscripción (logout / permiso revocado)
router.delete('/subscribe', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { endpoint } = req.body;
        if (!endpoint) throw new ServiceError(400, 'BAD_REQUEST', 'endpoint requerido');
        await removeSubscription(endpoint);
        res.json({ ok: true });
    } catch (err) { next(err); }
});

// GET /api/push/prefs — preferencias del usuario actual
router.get('/prefs', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user.id;
        const prefs = await getPrefs(userId);
        res.json(prefs);
    } catch (err) { next(err); }
});

// PATCH /api/push/prefs — actualizar preferencias
router.patch('/prefs', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user.id;
        const parsed = prefsSchema.safeParse(req.body);
        if (!parsed.success) throw new ServiceError(400, 'BAD_REQUEST', 'Datos de preferencias inválidos');

        await upsertPrefs(userId, parsed.data);
        res.json({ ok: true });
    } catch (err) { next(err); }
});

export default router;
