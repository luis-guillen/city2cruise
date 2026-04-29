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
    | 'HANDSHAKE_RENEWED'
    | 'PAYMENT_CREATED'
    | 'PAYMENT_CAPTURED'
    | 'PAYMENT_REFUNDED'
    | 'PAYMENT_FAILED';

export type LockerHwEventType =
    | 'OPEN'
    | 'CLOSE'
    | 'STATUS_CHECK'
    | 'EMERGENCY_OPEN'
    | 'MARKED_OUT_OF_SERVICE'
    | 'MARKED_ONLINE';

export type AuditActorRole = 'CLIENT' | 'DRIVER' | 'ADMIN' | 'SYSTEM';

export interface AuditEventParams {
    requestId: number;
    eventType: AuditEventType;
    actorId: number;
    actorRole?: AuditActorRole;
    metadata?: Record<string, unknown>;
    counterpartyActorId?: number | null;
    counterpartyRole?: AuditActorRole;
}

export interface AuditEvent {
    id: string;
    request_id: number;
    event_type: AuditEventType;
    actor_id: number;
    metadata: string | Record<string, unknown> | null;
    signature: string;
    block_index: number;
    previous_event_hash: string | null;
    event_hash: string;
    receipt_payload: string | CustodyReceipt | null;
    receipt_hash: string | null;
    created_at: string;
}

export interface CustodyReceiptAttestation {
    actorId: number;
    role: AuditActorRole;
    signature: string;
}

export interface CustodyReceipt {
    requestId: number;
    eventType: AuditEventType;
    issuedAt: string;
    blockIndex: number;
    previousEventHash: string | null;
    eventHash: string;
    metadataDigest: string;
    attestors: CustodyReceiptAttestation[];
}

export interface CustodyChainVerification {
    requestId: number;
    verified: boolean;
    storageMode: 'HASH_CHAINED_POSTGRES';
    blockCount: number;
    criticalBlockCount: number;
    lastEventHash: string | null;
    issues: string[];
    receipts: Array<{
        eventId: string;
        eventType: AuditEventType;
        valid: boolean;
        receiptHash: string | null;
    }>;
}

export interface LockerHwEventParams {
    lockerId: number;
    eventType: LockerHwEventType;
    actorId: number | null;
    metadata?: Record<string, unknown>;
}

function sortObject(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortObject);
    if (value && typeof value === 'object') {
        return Object.keys(value as Record<string, unknown>)
            .sort()
            .reduce<Record<string, unknown>>((acc, key) => {
                acc[key] = sortObject((value as Record<string, unknown>)[key]);
                return acc;
            }, {});
    }
    return value;
}

function stableStringify(value: unknown): string {
    return JSON.stringify(sortObject(value));
}

function hashSha256(payload: string): string {
    return crypto.createHash('sha256').update(payload).digest('hex');
}

function toIsoString(raw: unknown): string {
    return raw instanceof Date ? raw.toISOString() : String(raw);
}

function parseJsonField<T>(value: T | string | null): T | null {
    if (value == null) return null;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value) as T;
        } catch {
            return null;
        }
    }
    return value as T;
}

function computeSignature(requestId: number, eventType: string, actorId: number, timestamp: string): string {
    const payload = `${requestId}${eventType}${actorId}${timestamp}`;
    return crypto.createHmac('sha256', config.auditHmacSecret).update(payload).digest('hex');
}

function computeActorAttestation(
    requestId: number,
    eventType: AuditEventType,
    actorId: number,
    role: AuditActorRole,
    timestamp: string,
    metadataDigest: string,
): string {
    const payload = `${requestId}:${eventType}:${actorId}:${role}:${timestamp}:${metadataDigest}`;
    return crypto.createHmac('sha256', `${config.auditHmacSecret}:${actorId}:${role}`).update(payload).digest('hex');
}

function buildEventHash(params: {
    requestId: number;
    eventType: AuditEventType;
    actorId: number;
    signature: string;
    blockIndex: number;
    previousEventHash: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: string;
}): string {
    return hashSha256(stableStringify({
        requestId: params.requestId,
        eventType: params.eventType,
        actorId: params.actorId,
        signature: params.signature,
        blockIndex: params.blockIndex,
        previousEventHash: params.previousEventHash,
        metadata: params.metadata,
        createdAt: params.createdAt,
    }));
}

function isCriticalCustodyEvent(eventType: AuditEventType): boolean {
    return eventType === 'HANDSHAKE_VALIDATED'
        || eventType === 'DEPOSITED'
        || eventType === 'PICKED_UP';
}

function buildReceipt(params: {
    requestId: number;
    eventType: AuditEventType;
    blockIndex: number;
    previousEventHash: string | null;
    eventHash: string;
    createdAt: string;
    metadata: Record<string, unknown> | null;
    attestors: Array<{ actorId: number; role: AuditActorRole }>;
}): CustodyReceipt {
    const metadataDigest = hashSha256(stableStringify(params.metadata ?? {}));
    return {
        requestId: params.requestId,
        eventType: params.eventType,
        issuedAt: params.createdAt,
        blockIndex: params.blockIndex,
        previousEventHash: params.previousEventHash,
        eventHash: params.eventHash,
        metadataDigest,
        attestors: params.attestors.map((attestor) => ({
            ...attestor,
            signature: computeActorAttestation(
                params.requestId,
                params.eventType,
                attestor.actorId,
                attestor.role,
                params.createdAt,
                metadataDigest,
            ),
        })),
    };
}

function computeReceiptHash(receipt: CustodyReceipt): string {
    return hashSha256(stableStringify(receipt));
}

function buildExpectedChain(rows: AuditEvent[]): Array<{
    id: string;
    blockIndex: number;
    previousEventHash: string | null;
    signature: string;
    eventHash: string;
    receiptPayload: CustodyReceipt | null;
    receiptHash: string | null;
}> {
    let previousEventHash: string | null = null;

    return rows.map((row, index) => {
        const createdAt = toIsoString(row.created_at);
        const metadata = parseJsonField<Record<string, unknown>>(row.metadata);
        const signature = computeSignature(row.request_id, row.event_type, row.actor_id, createdAt);
        const blockIndex = index + 1;
        const eventHash = buildEventHash({
            requestId: row.request_id,
            eventType: row.event_type,
            actorId: row.actor_id,
            signature,
            blockIndex,
            previousEventHash,
            metadata,
            createdAt,
        });

        let receiptPayload: CustodyReceipt | null = null;
        let receiptHash: string | null = null;

        if (isCriticalCustodyEvent(row.event_type)) {
            const metadataActors = metadata?.custodyActors as Record<string, unknown> | undefined;
            const attestors: Array<{ actorId: number; role: AuditActorRole }> = [];

            if (typeof row.actor_id === 'number') {
                attestors.push({
                    actorId: row.actor_id,
                    role: (metadataActors?.actorRole as AuditActorRole) || 'SYSTEM',
                });
            }

            if (metadataActors?.counterpartyActorId && metadataActors?.counterpartyRole) {
                attestors.push({
                    actorId: Number(metadataActors.counterpartyActorId),
                    role: metadataActors.counterpartyRole as AuditActorRole,
                });
            }

            receiptPayload = buildReceipt({
                requestId: row.request_id,
                eventType: row.event_type,
                blockIndex,
                previousEventHash,
                eventHash,
                createdAt,
                metadata,
                attestors,
            });
            receiptHash = computeReceiptHash(receiptPayload);
        }

        const expected = {
            id: row.id,
            blockIndex,
            previousEventHash,
            signature,
            eventHash,
            receiptPayload,
            receiptHash,
        };

        previousEventHash = eventHash;
        return expected;
    });
}

async function backfillRequestChain(requestId: number): Promise<void> {
    const { rows } = await db.query<AuditEvent>(
        'SELECT * FROM audit_events WHERE request_id = $1 ORDER BY created_at ASC, id ASC',
        [requestId],
    );

    if (rows.length === 0) return;

    const expectedChain = buildExpectedChain(rows);
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const expected = expectedChain[i];
            const currentReceipt = parseJsonField<CustodyReceipt>(row.receipt_payload);
            const shouldUpdate =
                row.block_index !== expected.blockIndex
                || row.previous_event_hash !== expected.previousEventHash
                || row.signature !== expected.signature
                || row.event_hash !== expected.eventHash
                || stableStringify(currentReceipt) !== stableStringify(expected.receiptPayload)
                || row.receipt_hash !== expected.receiptHash;

            if (shouldUpdate) {
                await client.query(
                    `UPDATE audit_events
                     SET block_index = $1,
                         previous_event_hash = $2,
                         signature = $3,
                         event_hash = $4,
                         receipt_payload = $5,
                         receipt_hash = $6
                     WHERE id = $7`,
                    [
                        expected.blockIndex,
                        expected.previousEventHash,
                        expected.signature,
                        expected.eventHash,
                        expected.receiptPayload ? JSON.stringify(expected.receiptPayload) : null,
                        expected.receiptHash,
                        row.id,
                    ],
                );
            }
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

export async function logAuditEvent(params: AuditEventParams): Promise<void> {
    try {
        const id = createId();
        const now = new Date().toISOString();
        const signature = computeSignature(params.requestId, params.eventType, params.actorId, now);
        const actorRole = params.actorRole || 'SYSTEM';
        const metadata = {
            ...(params.metadata ?? {}),
            custodyActors: isCriticalCustodyEvent(params.eventType)
                ? {
                    actorRole,
                    counterpartyActorId: params.counterpartyActorId ?? null,
                    counterpartyRole: params.counterpartyRole ?? null,
                }
                : undefined,
        };

        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            const { rows: [previous] } = await client.query<Pick<AuditEvent, 'block_index' | 'event_hash'>>(
                `SELECT block_index, event_hash
                 FROM audit_events
                 WHERE request_id = $1
                 ORDER BY block_index DESC, created_at DESC, id DESC
                 LIMIT 1`,
                [params.requestId],
            );

            const previousEventHash = previous?.event_hash || null;
            const blockIndex = (previous?.block_index || 0) + 1;
            const eventHash = buildEventHash({
                requestId: params.requestId,
                eventType: params.eventType,
                actorId: params.actorId,
                signature,
                blockIndex,
                previousEventHash,
                metadata,
                createdAt: now,
            });

            let receiptPayload: CustodyReceipt | null = null;
            let receiptHash: string | null = null;
            if (isCriticalCustodyEvent(params.eventType)) {
                const attestors: Array<{ actorId: number; role: AuditActorRole }> = [
                    { actorId: params.actorId, role: actorRole },
                ];
                if (params.counterpartyActorId && params.counterpartyRole) {
                    attestors.push({
                        actorId: params.counterpartyActorId,
                        role: params.counterpartyRole,
                    });
                }
                receiptPayload = buildReceipt({
                    requestId: params.requestId,
                    eventType: params.eventType,
                    blockIndex,
                    previousEventHash,
                    eventHash,
                    createdAt: now,
                    metadata,
                    attestors,
                });
                receiptHash = computeReceiptHash(receiptPayload);
            }

            await client.query(
                `INSERT INTO audit_events (
                    id, request_id, event_type, actor_id, metadata, signature,
                    block_index, previous_event_hash, event_hash, receipt_payload, receipt_hash, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [
                    id,
                    params.requestId,
                    params.eventType,
                    params.actorId,
                    JSON.stringify(metadata),
                    signature,
                    blockIndex,
                    previousEventHash,
                    eventHash,
                    receiptPayload ? JSON.stringify(receiptPayload) : null,
                    receiptHash,
                    now,
                ],
            );

            await client.query('COMMIT');
            logger.info({
                eventType: params.eventType,
                requestId: params.requestId,
                actorId: params.actorId,
                auditId: id,
                blockIndex,
            }, 'Audit block recorded');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        logger.error({ err }, 'Failed to record audit event');
    }
}

export async function logLockerHwEvent(params: LockerHwEventParams): Promise<void> {
    try {
        const id = createId();
        const now = new Date().toISOString();
        const payload = `${params.lockerId}${params.eventType}${params.actorId ?? 'system'}${now}`;
        const signature = crypto.createHmac('sha256', config.auditHmacSecret).update(payload).digest('hex');
        const metadata = params.metadata ? JSON.stringify(params.metadata) : null;

        await db.query(
            `INSERT INTO locker_hw_events (id, locker_id, event_type, actor_id, metadata, signature, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, params.lockerId, params.eventType, params.actorId, metadata, signature, now],
        );

        logger.info(
            { eventType: params.eventType, lockerId: params.lockerId, actorId: params.actorId, hwAuditId: id },
            'Locker HW audit event recorded',
        );
    } catch (err) {
        logger.error({ err }, 'Failed to record locker HW audit event');
    }
}

export async function getAuditTrail(requestId: number): Promise<AuditEvent[]> {
    await backfillRequestChain(requestId);
    const { rows } = await db.query<AuditEvent>(
        'SELECT * FROM audit_events WHERE request_id = $1 ORDER BY created_at ASC, id ASC',
        [requestId],
    );
    return rows;
}

export function verifyEventSignature(event: AuditEvent): boolean {
    const ts = toIsoString(event.created_at);
    const expected = computeSignature(event.request_id, event.event_type, event.actor_id, ts);
    if (expected.length !== event.signature.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(event.signature, 'hex'));
}

function verifyReceipt(receipt: CustodyReceipt, event: AuditEvent): boolean {
    const metadata = parseJsonField<Record<string, unknown>>(event.metadata);
    const metadataDigest = hashSha256(stableStringify(metadata ?? {}));
    if (receipt.requestId !== event.request_id) return false;
    if (receipt.eventType !== event.event_type) return false;
    if (receipt.eventHash !== event.event_hash) return false;
    if (receipt.metadataDigest !== metadataDigest) return false;

    return receipt.attestors.every((attestor) => {
        const expected = computeActorAttestation(
            event.request_id,
            event.event_type,
            attestor.actorId,
            attestor.role,
            toIsoString(event.created_at),
            metadataDigest,
        );
        return expected === attestor.signature;
    });
}

export async function verifyCustodyChain(requestId: number): Promise<CustodyChainVerification> {
    const events = await getAuditTrail(requestId);
    const issues: string[] = [];
    const receipts: CustodyChainVerification['receipts'] = [];
    let previousEventHash: string | null = null;

    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const metadata = parseJsonField<Record<string, unknown>>(event.metadata);
        const expectedSignature = computeSignature(event.request_id, event.event_type, event.actor_id, toIsoString(event.created_at));
        const expectedEventHash = buildEventHash({
            requestId: event.request_id,
            eventType: event.event_type,
            actorId: event.actor_id,
            signature: expectedSignature,
            blockIndex: i + 1,
            previousEventHash,
            metadata,
            createdAt: toIsoString(event.created_at),
        });

        if (event.block_index !== i + 1) {
            issues.push(`Bloque ${event.id}: block_index esperado ${i + 1}, actual ${event.block_index}`);
        }
        if (event.previous_event_hash !== previousEventHash) {
            issues.push(`Bloque ${event.id}: previous_event_hash no coincide`);
        }
        if (!verifyEventSignature(event)) {
            issues.push(`Bloque ${event.id}: firma HMAC inválida`);
        }
        if (event.event_hash !== expectedEventHash) {
            issues.push(`Bloque ${event.id}: event_hash inválido`);
        }

        if (isCriticalCustodyEvent(event.event_type)) {
            const receipt = parseJsonField<CustodyReceipt>(event.receipt_payload);
            const receiptValid = !!receipt
                && verifyReceipt(receipt, event)
                && computeReceiptHash(receipt) === event.receipt_hash;

            if (!receiptValid) {
                issues.push(`Bloque ${event.id}: recibo de custodia inválido`);
            }
            receipts.push({
                eventId: event.id,
                eventType: event.event_type,
                valid: receiptValid,
                receiptHash: event.receipt_hash,
            });
        }

        previousEventHash = event.event_hash;
    }

    return {
        requestId,
        verified: issues.length === 0,
        storageMode: 'HASH_CHAINED_POSTGRES',
        blockCount: events.length,
        criticalBlockCount: receipts.length,
        lastEventHash: events.at(-1)?.event_hash || null,
        issues,
        receipts,
    };
}
