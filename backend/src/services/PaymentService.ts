import Stripe from 'stripe';
import { db } from '../db/database';
import { config } from '../config/env';
import { logAuditEvent } from './AuditService';
import { logger } from '../utils/logger';
import { ServiceError } from '../utils/errors';

const stripe = new Stripe(config.stripe.secretKey, { apiVersion: '2026-04-22.dahlia' });

// Centavos por tamaño de paquete (precio base). Editable via pricing_rules en DB.
const DEFAULT_PRICES_CENTS: Record<string, number> = {
    SMALL: 500,   // 5,00 €
    MEDIUM: 800,  // 8,00 €
    LARGE: 1200,  // 12,00 €
};

async function getPriceCents(packageSize: string): Promise<number> {
    const { rows } = await db.query(
        `SELECT base_price_cents FROM pricing_rules
         WHERE package_size = $1 AND active = TRUE
         ORDER BY created_at DESC LIMIT 1`,
        [packageSize],
    );
    return rows[0]?.base_price_cents ?? DEFAULT_PRICES_CENTS[packageSize] ?? 500;
}

// ── a) createIntent ──────────────────────────────────────────────────────────

export async function createPaymentIntent(params: {
    requestId: number;
    clientId: number;
    packageSize: string;
}): Promise<{ clientSecret: string; paymentId: number; amountCents: number }> {
    const { requestId, clientId, packageSize } = params;

    // Verificar que el pedido existe, pertenece al cliente y está en REQUESTED
    const { rows: [req] } = await db.query(
        'SELECT id, status, client_id FROM pickup_requests WHERE id = $1',
        [requestId],
    );
    if (!req) throw new ServiceError(404, 'NOT_FOUND', 'Pedido no encontrado');
    if (req.client_id !== clientId) throw new ServiceError(403, 'FORBIDDEN', 'No eres el dueño de este pedido');
    if (req.status !== 'REQUESTED') {
        throw new ServiceError(409, 'CONFLICT', 'Solo se puede iniciar pago en estado REQUESTED');
    }

    // Idempotencia: si ya existe un PaymentIntent activo para este pedido, devolverlo
    const { rows: [existing] } = await db.query(
        `SELECT id, stripe_client_secret, amount_cents FROM payments
         WHERE request_id = $1 AND status IN ('PENDING','AUTHORIZED')
         ORDER BY created_at DESC LIMIT 1`,
        [requestId],
    );
    if (existing?.stripe_client_secret) {
        return {
            clientSecret: existing.stripe_client_secret,
            paymentId: existing.id,
            amountCents: existing.amount_cents,
        };
    }

    const amountCents = await getPriceCents(packageSize);
    const currency = config.stripe.currency;

    // Auth-and-capture: capture_method = 'manual' → solo autoriza, no cobra
    const intent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency,
        capture_method: 'manual',
        metadata: { requestId: String(requestId), clientId: String(clientId) },
    });

    const { rows: [payment] } = await db.query(
        `INSERT INTO payments
           (request_id, client_id, amount_cents, currency, status, stripe_payment_intent_id, stripe_client_secret)
         VALUES ($1, $2, $3, $4, 'PENDING', $5, $6)
         RETURNING id`,
        [requestId, clientId, amountCents, currency, intent.id, intent.client_secret],
    );

    await logAuditEvent({
        requestId,
        eventType: 'PAYMENT_CREATED',
        actorId: clientId,
        metadata: { paymentIntentId: intent.id, amountCents, currency },
    });

    logger.info({ requestId, paymentIntentId: intent.id, amountCents }, 'PaymentIntent created (auth-only)');

    return { clientSecret: intent.client_secret!, paymentId: payment.id, amountCents };
}

// ── b) capturePayment ────────────────────────────────────────────────────────
// Llamar DESPUÉS del handshake exitoso.

export async function capturePayment(params: {
    requestId: number;
    actorId: number;
}): Promise<void> {
    const { requestId, actorId } = params;

    const { rows: [payment] } = await db.query(
        `SELECT id, stripe_payment_intent_id, amount_cents, status
         FROM payments WHERE request_id = $1 AND status = 'AUTHORIZED'
         ORDER BY created_at DESC LIMIT 1`,
        [requestId],
    );
    if (!payment) {
        logger.warn({ requestId }, 'capturePayment: no AUTHORIZED payment found, skipping');
        return;
    }

    await stripe.paymentIntents.capture(payment.stripe_payment_intent_id);

    await db.query(
        `UPDATE payments SET status = 'CAPTURED', captured_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [payment.id],
    );

    await logAuditEvent({
        requestId,
        eventType: 'PAYMENT_CAPTURED',
        actorId,
        metadata: { paymentId: payment.id, amountCents: payment.amount_cents },
    });

    logger.info({ requestId, paymentId: payment.id }, 'Payment captured after handshake');
}

// ── c) refundPayment ─────────────────────────────────────────────────────────

export async function refundPayment(params: {
    requestId: number;
    actorId: number;
    reason: 'cancelled_before_assignment' | 'driver_no_show' | 'admin_manual';
}): Promise<void> {
    const { requestId, actorId, reason } = params;

    const { rows: [payment] } = await db.query(
        `SELECT id, stripe_payment_intent_id, amount_cents, status
         FROM payments WHERE request_id = $1 AND status IN ('AUTHORIZED','CAPTURED')
         ORDER BY created_at DESC LIMIT 1`,
        [requestId],
    );
    if (!payment) {
        logger.warn({ requestId }, 'refundPayment: no refundable payment found, skipping');
        return;
    }

    const refund = await stripe.refunds.create({
        payment_intent: payment.stripe_payment_intent_id,
        reason: 'requested_by_customer',
        metadata: { requestId: String(requestId), reason },
    });

    const pgClient = await db.getClient();
    try {
        await pgClient.query('BEGIN');
        await pgClient.query(
            `INSERT INTO payment_refunds (payment_id, stripe_refund_id, amount_cents, reason, status)
             VALUES ($1, $2, $3, $4, 'PENDING')
             ON CONFLICT (stripe_refund_id) DO NOTHING`,
            [payment.id, refund.id, payment.amount_cents, reason],
        );
        await pgClient.query(
            `UPDATE payments SET status = 'REFUNDED', refunded_at = NOW(), refund_reason = $1, updated_at = NOW()
             WHERE id = $2`,
            [reason, payment.id],
        );
        await pgClient.query('COMMIT');
    } catch (err) {
        await pgClient.query('ROLLBACK');
        throw err;
    } finally {
        pgClient.release();
    }

    await logAuditEvent({
        requestId,
        eventType: 'PAYMENT_REFUNDED',
        actorId,
        metadata: { paymentId: payment.id, refundId: refund.id, reason },
    });

    logger.info({ requestId, refundId: refund.id, reason }, 'Payment refunded');
}

// ── d) getPaymentHistory ─────────────────────────────────────────────────────

export async function getPaymentHistory(params: { clientId: number }) {
    const { rows } = await db.query(
        `SELECT p.id, p.request_id, p.amount_cents, p.currency, p.status,
                p.captured_at, p.refunded_at, p.refund_reason, p.created_at,
                pr.pickup_location, pr.package_size
         FROM payments p
         JOIN pickup_requests pr ON p.request_id = pr.id
         WHERE p.client_id = $1
         ORDER BY p.created_at DESC`,
        [params.clientId],
    );
    return rows;
}

// ── e) cancelPendingPayment ──────────────────────────────────────────────────
// Para cancelaciones antes de asignación de conductor.

export async function cancelPendingPayment(params: {
    requestId: number;
    actorId: number;
}): Promise<void> {
    const { requestId, actorId } = params;

    const { rows: [payment] } = await db.query(
        `SELECT id, stripe_payment_intent_id, status FROM payments
         WHERE request_id = $1 AND status IN ('PENDING','AUTHORIZED')
         ORDER BY created_at DESC LIMIT 1`,
        [requestId],
    );
    if (!payment) return;

    if (payment.status === 'AUTHORIZED') {
        await refundPayment({ requestId, actorId, reason: 'cancelled_before_assignment' });
    } else {
        // Todavía PENDING → cancelar el intent directamente
        await stripe.paymentIntents.cancel(payment.stripe_payment_intent_id);
        await db.query(
            `UPDATE payments SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`,
            [payment.id],
        );
    }
}

// ── Exportar instancia stripe para el webhook handler ───────────────────────
export { stripe };
