import { Router, Request, Response, NextFunction } from 'express';
import { config } from '../config/env';
import { authMiddleware as authenticate, requireRole } from '../auth/middleware';
import {
    createPaymentIntent,
    confirmPaymentIntent,
    capturePayment,
    refundPayment,
    getPaymentHistory,
    stripe,
} from '../services/PaymentService';
import { db } from '../db/database';
import { logAuditEvent } from '../services/AuditService';
import { logger } from '../utils/logger';
import { ServiceError } from '../utils/errors';

const router = Router();

// ── POST /api/payments/create-intent ────────────────────────────────────────
// Cliente crea un PaymentIntent antes de confirmar la solicitud.
router.post('/create-intent', authenticate, requireRole('CLIENT'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const clientId = (req as any).user.id;
        const { requestId, packageSize } = req.body;

        if (!requestId || !packageSize) {
            throw new ServiceError(400, 'BAD_REQUEST', 'requestId y packageSize son obligatorios');
        }

        const result = await createPaymentIntent({
            requestId: Number(requestId),
            clientId,
            packageSize,
        });

        res.json(result);
    } catch (err) {
        next(err);
    }
});

// ── POST /api/payments/confirm ───────────────────────────────────────────────
// Marca el PaymentIntent como AUTHORIZED (Stripe lo hace en su webhook).
// Este endpoint es para que el frontend notifique que Stripe Elements confirmó el pago.
router.post('/confirm', authenticate, requireRole('CLIENT'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const clientId = (req as any).user.id;
        const { requestId, paymentIntentId } = req.body;

        if (!requestId || !paymentIntentId) {
            throw new ServiceError(400, 'BAD_REQUEST', 'requestId y paymentIntentId son obligatorios');
        }
        const result = await confirmPaymentIntent({
            requestId: Number(requestId),
            clientId,
            paymentIntentId,
        });
        res.json(result);
    } catch (err) {
        next(err);
    }
});

// ── GET /api/payments/history ────────────────────────────────────────────────
router.get('/history', authenticate, requireRole('CLIENT'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const clientId = (req as any).user.id;
        const history = await getPaymentHistory({ clientId });
        res.json(history);
    } catch (err) {
        next(err);
    }
});

// ── POST /api/payments/admin/refund ─────────────────────────────────────────
router.post('/admin/refund', authenticate, requireRole('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const adminId = (req as any).user.id;
        const { requestId } = req.body;
        if (!requestId) throw new ServiceError(400, 'BAD_REQUEST', 'requestId es obligatorio');

        await refundPayment({ requestId: Number(requestId), actorId: adminId, reason: 'admin_manual' });
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

// ── POST /webhooks/stripe ────────────────────────────────────────────────────
// IMPORTANTE: este endpoint necesita el body RAW (no parseado por express.json).
// Se monta en server.ts ANTES de express.json({ limit }) con express.raw().
export const stripeWebhookHandler = async (req: Request, res: Response): Promise<void> => {
    const sig = req.headers['stripe-signature'] as string;

    if (!sig) {
        logger.warn('Stripe webhook: missing stripe-signature header');
        res.status(400).json({ error: 'Missing stripe-signature' });
        return;
    }

    if (!config.stripe.webhookSecret) {
        logger.error('STRIPE_WEBHOOK_SECRET not configured');
        res.status(500).json({ error: 'Webhook not configured' });
        return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let event: any;
    try {
        event = stripe.webhooks.constructEvent(req.body as Buffer, sig, config.stripe.webhookSecret);
    } catch (err: any) {
        logger.warn({ message: err.message }, 'Stripe webhook signature verification failed');
        res.status(400).json({ error: `Webhook signature invalid: ${err.message}` });
        return;
    }

    // Idempotencia: si ya procesamos este evento, retornar 200 inmediatamente
    const { rowCount } = await db.query(
        `INSERT INTO stripe_webhook_events (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
        [event.id, event.type],
    );
    if (rowCount === 0) {
        logger.info({ eventId: event.id, type: event.type }, 'Stripe webhook already processed, skipping');
        res.json({ received: true, duplicate: true });
        return;
    }

    try {
        await handleStripeEvent(event);
        res.json({ received: true });
    } catch (err) {
        logger.error({ err, eventId: event.id, type: event.type }, 'Stripe webhook handler error');
        res.status(500).json({ error: 'Webhook handler failed' });
    }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleStripeEvent(event: any): Promise<void> {
    const requestIdStr = event.data?.object?.metadata?.requestId as string | undefined;
    const requestId = requestIdStr ? parseInt(requestIdStr, 10) : null;

    switch (event.type) {
        case 'payment_intent.amount_capturable_updated': {
            // El cliente confirmó el pago en Stripe Elements → cambia a AUTHORIZED
            const intent = event.data.object;
            await db.query(
                `UPDATE payments SET status = 'AUTHORIZED', updated_at = NOW()
                 WHERE stripe_payment_intent_id = $1 AND status = 'PENDING'`,
                [intent.id],
            );
            logger.info({ intentId: intent.id, requestId }, 'Webhook: PaymentIntent authorized');
            break;
        }

        case 'payment_intent.succeeded': {
            const intent = event.data.object;
            await db.query(
                `UPDATE payments SET status = 'CAPTURED', captured_at = NOW(), updated_at = NOW()
                 WHERE stripe_payment_intent_id = $1`,
                [intent.id],
            );
            if (requestId) {
                await logAuditEvent({
                    requestId,
                    eventType: 'PAYMENT_CAPTURED',
                    actorId: 0,
                    metadata: { paymentIntentId: intent.id, source: 'webhook' },
                });
            }
            logger.info({ intentId: intent.id, requestId }, 'Webhook: PaymentIntent succeeded');
            break;
        }

        case 'payment_intent.payment_failed': {
            const intent = event.data.object;
            const failureMsg = intent.last_payment_error?.message ?? 'unknown';
            await db.query(
                `UPDATE payments SET status = 'FAILED', updated_at = NOW()
                 WHERE stripe_payment_intent_id = $1`,
                [intent.id],
            );
            if (requestId) {
                await logAuditEvent({
                    requestId,
                    eventType: 'PAYMENT_FAILED',
                    actorId: 0,
                    metadata: { paymentIntentId: intent.id, reason: failureMsg },
                });
            }
            logger.warn({ intentId: intent.id, requestId, failureMsg }, 'Webhook: PaymentIntent failed');
            break;
        }

        case 'payment_intent.canceled': {
            const intent = event.data.object;
            await db.query(
                `UPDATE payments SET status = 'CANCELLED', updated_at = NOW()
                 WHERE stripe_payment_intent_id = $1`,
                [intent.id],
            );
            logger.info({ intentId: intent.id, requestId }, 'Webhook: PaymentIntent cancelled');
            break;
        }

        case 'charge.refunded': {
            const charge = event.data.object;
            // Actualizar refunds registrados si Stripe confirma el reembolso
            for (const refundObj of charge.refunds?.data ?? []) {
                await db.query(
                    `UPDATE payment_refunds SET status = 'SUCCEEDED' WHERE stripe_refund_id = $1`,
                    [refundObj.id],
                );
            }
            if (requestId) {
                await logAuditEvent({
                    requestId,
                    eventType: 'PAYMENT_REFUNDED',
                    actorId: 0,
                    metadata: { chargeId: charge.id, source: 'webhook' },
                });
            }
            logger.info({ chargeId: charge.id, requestId }, 'Webhook: charge refunded');
            break;
        }

        default:
            logger.debug({ type: event.type }, 'Stripe webhook: unhandled event type');
    }
}

export default router;
