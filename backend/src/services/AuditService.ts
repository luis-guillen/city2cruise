import crypto from 'crypto';
import { createId } from '@paralleldrive/cuid2';
import { db } from '../db/database';
import { config } from '../config/env';
import { logger } from '../utils/logger';

export type AuditEventType =
    | 'REQUESTED'
    | 'ASSIGNED'
    | 'CONFIRMATION_PENDING'
    | 'HANDSHAKE_VALIDATED'
    | 'IN_PROGRESS'
    | 'DEPOSITED'
    | 'PICKED_UP'
    | 'CANCELLED'
    | 'RATE_LIMIT_BLOCK'
    | 'HANDSHAKE_RENEWED';

export interface AuditEventParams {
    requestId: number;
    eventType: AuditEventType;
    actorId: number;
    metadata?: Record<string, unknown>;
}

export interface AuditEvent {
    id: string;
    request_id: number;
    event_type: AuditEventType;
    actor_id: number;
    metadata: string | null;
    signature: string;
    created_at: string;
}

function computeSignature(requestId: number, eventType: string, actorId: number, timestamp: string): string {
    const payload = `${requestId}${eventType}${actorId}${timestamp}`;
    return crypto.createHmac('sha256', config.jwtSecret).update(payload).digest('hex');
}

/**
 * Registra un evento de auditoría con firma HMAC-SHA256.
 * Fire-and-forget: nunca lanza excepción para no interrumpir el flujo principal.
 */
export async function logAuditEvent(params: AuditEventParams): Promise<void> {
    try {
        const id = createId();
        const now = new Date().toISOString();
        const signature = computeSignature(params.requestId, params.eventType, params.actorId, now);
        const metadata = params.metadata ? JSON.stringify(params.metadata) : null;

        await db.query(
            `INSERT INTO audit_events (id, request_id, event_type, actor_id, metadata, signature, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, params.requestId, params.eventType, params.actorId, metadata, signature, now]
        );

        logger.info({ eventType: params.eventType, requestId: params.requestId, actorId: params.actorId, auditId: id }, 'Audit event recorded');
    } catch (err) {
        logger.error({ err }, 'Failed to record audit event');
    }
}

/**
 * Retorna el trail de auditoría completo de una solicitud, ordenado cronológicamente.
 */
export async function getAuditTrail(requestId: number): Promise<AuditEvent[]> {
    const { rows } = await db.query<AuditEvent>(
        'SELECT * FROM audit_events WHERE request_id = $1 ORDER BY created_at ASC',
        [requestId]
    );
    return rows;
}

/**
 * Verifica que la firma HMAC de un evento almacenado es válida.
 */
export function verifyEventSignature(event: AuditEvent): boolean {
    // PG retorna Date para TIMESTAMPTZ; normalizar a ISO string como se almacenó
    const rawTs = event.created_at as unknown;
    const ts = rawTs instanceof Date
        ? rawTs.toISOString()
        : String(event.created_at);
    const expected = computeSignature(event.request_id, event.event_type, event.actor_id, ts);
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(event.signature, 'hex'));
}
