import crypto from 'crypto';
import { db } from '../db/database';
import { buildPickupRequestDTO, sanitizeForSocket } from '../utils/dto';
import { logAuditEvent } from './AuditService';
import { startCascadeSearch, cancelCascade } from './GeoDispatchService';
import { logger } from '../utils/logger';
import { ServiceError } from '../utils/errors';
import { encryptField, decryptField } from '../utils/crypto';
import { notifyDepositReady, notifyRequestAssigned } from './NotificationService';
import { config } from '../config/env';
import { requestsCreatedTotal, requestsCompletedTotal, requestMatchSeconds } from '../observability/metrics';
import { syncRequestCreated, syncRequestAssigned, syncRequestDeposited } from './twin/TwinSyncService';
import {
    abortCustodyCommit,
    finalizeCustodyCommit,
    getLatestCustodySummary,
    getOrCreateCustodyChallenge,
    markChallengeCommitted,
    prepareCustodyCommit,
} from './CustodyLedgerService';

const MAX_HANDSHAKE_ATTEMPTS = 3;

export const LOCKER_SIZES_FOR: Record<string, string[]> = {
    SMALL: ['S', 'M', 'L'],
    MEDIUM: ['M', 'L'],
    LARGE: ['L'],
};

async function attachCustodyState(dto: any) {
    dto.custodySummary = await getLatestCustodySummary(Number(dto.id));
    if (dto.status === 'CONFIRMATION_PENDING') {
        try {
            const challenge = await getOrCreateCustodyChallenge({
                requestId: Number(dto.id),
                eventType: 'HANDSHAKE_VALIDATED',
                requesterId: dto.clientId,
                requesterRole: 'CLIENT',
                eventPayload: {},
            });
            dto.custodyChallenge = {
                ...challenge,
                signatures: challenge.signatures.map((signature) => ({
                    actorId: signature.actorId,
                    role: signature.role,
                    signature: signature.signature,
                })),
            };
        } catch {
            dto.custodyChallenge = null;
        }
    } else {
        dto.custodyChallenge = null;
    }
    return dto;
}

// ── a) createRequest ────────────────────────────────────────────────────────

export async function createRequest(
    params: {
        userId: number;
        userName: string;
        pickupLocation: string;
        latitude: number | null;
        longitude: number | null;
        packageSize: string;
        merchantId?: number;
    }
) {
    const now = new Date().toISOString();

    if (params.merchantId != null) {
        const { rows } = await db.query(
            "SELECT id FROM merchants WHERE id = $1 AND integration_status = 'active'",
            [params.merchantId]
        );
        if (rows.length === 0) {
            throw new ServiceError(400, 'BAD_REQUEST', 'El merchant especificado no existe o no está activo');
        }
    }

    // 1. Verificar disponibilidad de lockers compatibles
    const allowedLockerSizes = LOCKER_SIZES_FOR[params.packageSize] ?? ['S', 'M', 'L'];
    const placeholders = allowedLockerSizes.map((_, i) => `$${i + 1}`).join(', ');
    
    const { rows: [locker] } = await db.query(
        `SELECT id, label FROM lockers WHERE is_occupied = FALSE AND size_category IN (${placeholders}) ORDER BY id ASC LIMIT 1`,
        allowedLockerSizes
    );

    if (!locker) {
        throw new ServiceError(409, 'NO_LOCKERS_FREE', 'No hay taquillas disponibles para este tamaño de paquete');
    }

    const lat = params.latitude ?? null;
    const lon = params.longitude ?? null;

    // 2. Crear solicitud con locker ya asignado
    const { rows: [inserted] } = await db.query(
        `INSERT INTO pickup_requests (
            client_id, pickup_location, latitude, longitude, pickup_location_geo, 
            package_size, merchant_id, status, locker_id, created_at, updated_at
         )
         VALUES ($1, $2, $3::FLOAT8, $4::FLOAT8,
                 CASE WHEN $3::FLOAT8 IS NOT NULL AND $4::FLOAT8 IS NOT NULL THEN ST_SetSRID(ST_MakePoint($4::FLOAT8, $3::FLOAT8), 4326)::geography ELSE NULL END,
                 $5, $6, 'REQUESTED', $7, $8, $9) RETURNING *`,
        [params.userId, params.pickupLocation, lat, lon,
         params.packageSize, params.merchantId ?? null, locker.id, now, now]
    );

    // 3. Marcar locker como ocupado temporalmente
    await db.query(
        'UPDATE lockers SET is_occupied = TRUE, current_request_id = $1, updated_at = $2 WHERE id = $3',
        [inserted.id, now, locker.id]
    );

    const dto = buildPickupRequestDTO(inserted);
    logger.info({ requestId: dto.id, client: params.userName, locker: locker.label }, 'Request created with reserved locker');
    
    await logAuditEvent({
        requestId: dto.id,
        eventType: 'REQUESTED',
        actorId: params.userId,
        actorRole: 'CLIENT',
        metadata: {
            pickupLocation: dto.pickupLocation,
            packageSize: dto.packageSize,
        },
    });

    // Hito 5.3.3 — métrica business: request creada
    requestsCreatedTotal.inc({ locker_id: String(locker.id) });

    // Hito 5.4.3 — telemetría al twin (fire-and-forget)
    syncRequestCreated(dto.id, params.userId, locker.id).catch(() => {});

    const safeDto = sanitizeForSocket(dto);
    startCascadeSearch(dto.id, params.userId, safeDto);

    return { dto };
}

// ── b) acceptRequest ────────────────────────────────────────────────────────

export async function acceptRequest(
    params: {
        requestId: string;
        driverId: number;
        driverName: string;
        driverLat?: number;
        driverLon?: number;
        radiusKm?: number;
    }
) {
    const { requestId, driverId, driverName, driverLat, driverLon, radiusKm } = params;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const handshakeCode = crypto.randomInt(1000, 9999).toString();
    const handshakeStore = encryptField(handshakeCode);

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const { rows: [existing] } = await client.query(
            'SELECT status, latitude, longitude, pickup_location_geo FROM pickup_requests WHERE id = $1',
            [requestId]
        );

        if (!existing) {
            await client.query('ROLLBACK');
            throw new ServiceError(404, 'NOT_FOUND', 'Pedido no encontrado');
        }
        if (existing.status !== 'REQUESTED') {
            await client.query('ROLLBACK');
            logger.warn({ requestId, driver: driverName, currentStatus: existing.status }, 'Accept conflict: request no longer available');
            throw new ServiceError(409, 'CONFLICT', 'El pedido ya no está disponible');
        }

        if (driverLat !== undefined && driverLon !== undefined && radiusKm !== undefined) {
            if (existing.pickup_location_geo != null) {
                const { rows: [distRow] } = await client.query(
                    `SELECT ST_Distance(
                       pickup_location_geo,
                       ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
                     ) / 1000.0 AS distance_km
                     FROM pickup_requests WHERE id = $3`,
                    [driverLon, driverLat, requestId]
                );
                if (distRow && distRow.distance_km > radiusKm) {
                    await client.query('ROLLBACK');
                    logger.warn({ distanceKm: distRow.distance_km, radiusKm }, 'Geo reject: driver out of radius');
                    throw new ServiceError(403, 'FORBIDDEN', 'La recogida está fuera de tu radio actual de alcance');
                }
            }
        }

        const { rowCount } = await client.query(`
            UPDATE pickup_requests
            SET status = 'CONFIRMATION_PENDING',
                driver_id = $1,
                handshake_code = $2,
                handshake_expires_at = $3,
                client_confirmed = FALSE,
                driver_confirmed = FALSE,
                updated_at = $4
            WHERE id = $5 AND status = 'REQUESTED'
        `, [driverId, handshakeStore, expiresAt, now, requestId]);

        if (rowCount === 0) {
            await client.query('ROLLBACK');
            throw new ServiceError(409, 'CONFLICT', 'El pedido ya no está disponible');
        }

        await client.query('COMMIT');
    } catch (err) {
        if (err instanceof ServiceError) throw err;
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    logger.info({ requestId, driver: driverName }, 'Request accepted, pending confirmation');
    await logAuditEvent({
        requestId: Number(requestId),
        eventType: 'ASSIGNED',
        actorId: driverId,
        actorRole: 'DRIVER',
        metadata: {
            driverName,
        },
    });
    cancelCascade(Number(requestId));

    const { rows: [row] } = await db.query(`
        SELECT r.*, u.name as driver_name, u.latitude as driver_latitude, u.longitude as driver_longitude
        FROM pickup_requests r
        LEFT JOIN users u ON r.driver_id = u.id
        WHERE r.id = $1
    `, [requestId]);
    const dto = buildPickupRequestDTO(row);
    const custodyChallenge = await getOrCreateCustodyChallenge({
        requestId: Number(requestId),
        eventType: 'HANDSHAKE_VALIDATED',
        requesterId: driverId,
        requesterRole: 'DRIVER',
        eventPayload: {},
    });
    await attachCustodyState(dto);

    // Notify client: conductor en camino (fire-and-forget)
    notifyRequestAssigned(dto.clientId).catch(() => {});

    // Hito 5.3.3 — métrica business: tiempo desde request hasta acept
    if (row.created_at) {
        const matchMs = Date.now() - new Date(row.created_at).getTime();
        if (matchMs >= 0 && matchMs < 86_400_000) {
            requestMatchSeconds.observe(matchMs / 1000);
        }
    }

    // Hito 5.4.3 — telemetría al twin
    syncRequestAssigned(dto.id, driverId).catch(() => {});

    return { dto, handshakeCode, custodyChallenge };
}

// ── c) confirmHandshake ─────────────────────────────────────────────────────

export async function confirmHandshake(
    params: {
        requestId: string;
        clientId: number;
        handshakeCode: string;
        challengeId?: string;
        clientLat?: number;
        clientLon?: number;
    }
) {
    const { requestId, clientId, handshakeCode, challengeId, clientLat, clientLon } = params;
    const now = new Date().toISOString();

    const { rows: [request] } = await db.query('SELECT * FROM pickup_requests WHERE id = $1', [requestId]);
    if (!request) throw new ServiceError(404, 'NOT_FOUND', 'Pedido no encontrado');
    if (request.client_id !== clientId) throw new ServiceError(403, 'FORBIDDEN', 'No eres el dueño de este pedido');
    if (request.status !== 'CONFIRMATION_PENDING') throw new ServiceError(409, 'CONFLICT', 'El pedido no está en espera de confirmación');

    // GPS proximity validation via PostGIS (mandatory when client coordinates are provided)
    if (clientLat !== undefined && clientLon !== undefined) {
        const { rows: [distResult] } = await db.query(
            `SELECT ST_Distance(
               location,
               ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
             ) AS distance_m
             FROM users WHERE id = $3 AND location IS NOT NULL`,
            [clientLon, clientLat, request.driver_id]
        );
        if (distResult) {
            const maxMeters = config.gpsProximityMaxMeters;
            if (distResult.distance_m > maxMeters) {
                throw new ServiceError(403, 'GPS_PROXIMITY_FAILED', 'Validación de proximidad fallida. Distancia excesiva.', {
                    distance_meters: Math.round(distResult.distance_m),
                    max_meters: maxMeters,
                });
            }
        }
    }

    // Rate limiting
    const { rows: [failedResult] } = await db.query(
        "SELECT COUNT(*)::int as count FROM handshake_attempts WHERE request_id = $1 AND result = 'failure'",
        [requestId]
    );
    const failedAttempts = failedResult.count as number;

    if (failedAttempts >= MAX_HANDSHAKE_ATTEMPTS) {
        logger.warn({ requestId, failedAttempts, clientId }, 'Handshake blocked: max attempts exceeded');
        throw new ServiceError(423, 'RATE_LIMIT_PIN_EXCEEDED', 'Handshake bloqueado. Máximo de intentos alcanzado. Contacte soporte L1.');
    }

    if (new Date(request.handshake_expires_at) < new Date(now)) {
        logger.warn({ requestId, expiresAt: request.handshake_expires_at }, 'Handshake expired');
        await db.query(
            `UPDATE pickup_requests SET status = $1, driver_id = NULL, handshake_code = NULL, handshake_expires_at = NULL, updated_at = $2 WHERE id = $3`,
            ['REQUESTED', now, requestId]
        );
        throw new ServiceError(410, 'GONE', 'El código ha expirado. El pedido vuelve a estar disponible.');
    }

    logger.debug({ requestId }, 'Verifying handshake code');
    const storedCode = decryptField(request.handshake_code);
    const isValid = storedCode !== null && handshakeCode === storedCode;
    const attemptNumber = failedAttempts + 1;

    if (!isValid) {
        await db.query(
            `INSERT INTO handshake_attempts (request_id, driver_id, attempt_number, result, failure_reason, created_at)
             VALUES ($1, $2, $3, 'failure', 'PIN_MISMATCH', $4)`,
            [requestId, request.driver_id, attemptNumber, now]
        );

        await db.query(
            'UPDATE pickup_requests SET handshake_attempts_count = handshake_attempts_count + 1, updated_at = $1 WHERE id = $2',
            [now, requestId]
        );

        const newFailedCount = failedAttempts + 1;
        logger.warn({ requestId, attempt: newFailedCount, max: MAX_HANDSHAKE_ATTEMPTS }, 'Handshake failed');

        if (newFailedCount >= MAX_HANDSHAKE_ATTEMPTS) {
            await logAuditEvent({
                requestId: Number(requestId),
                eventType: 'RATE_LIMIT_BLOCK',
                actorId: clientId,
                actorRole: 'CLIENT',
                metadata: { failedAttempts: newFailedCount },
            });
            logger.error({ requestId }, 'Handshake blocked: max attempts reached, L1 intervention required');
        }

        throw new ServiceError(400, 'INVALID_CODE', 'Código incorrecto');
    }

    // Código correcto
    await db.query(
        `INSERT INTO handshake_attempts (request_id, driver_id, attempt_number, result, failure_reason, created_at)
         VALUES ($1, $2, $3, 'success', NULL, $4)`,
        [requestId, request.driver_id, attemptNumber, now]
    );

    const { rowCount } = await db.query(
        `UPDATE pickup_requests SET status = $1, handshake_code = NULL, handshake_expires_at = NULL,
         client_latitude = $2, client_longitude = $3, updated_at = $4
         WHERE id = $5 AND status = 'CONFIRMATION_PENDING'`,
        ['IN_PROGRESS', clientLat ?? null, clientLon ?? null, now, requestId]
    );

    if (rowCount === 0) {
        throw new ServiceError(409, 'CONFLICT', 'El pedido ya no está disponible');
    }

    let preparedCommit: Awaited<ReturnType<typeof prepareCustodyCommit>> | null = null;
    if (challengeId) {
        preparedCommit = await prepareCustodyCommit({
            challengeId,
            eventType: 'HANDSHAKE_VALIDATED',
            systemAttestationMetadata: [],
        });

        try {
            await finalizeCustodyCommit(preparedCommit.proposalId);
            await markChallengeCommitted(challengeId);
        } catch (err) {
            await abortCustodyCommit(preparedCommit.proposalId);
            await db.query(`
                UPDATE pickup_requests
                SET status = 'CONFIRMATION_PENDING', updated_at = $1
                WHERE id = $2
            `, [new Date().toISOString(), requestId]);
            logger.error({
                err,
                requestId,
                challengeId,
                proposalId: preparedCommit.proposalId,
            }, 'Custody ledger commit failed during handshake confirmation; state compensated back to CONFIRMATION_PENDING');
            throw err;
        }
    } else if (config.env !== 'test') {
        throw new ServiceError(400, 'CUSTODY_CHALLENGE_REQUIRED', 'Se requiere challenge firmado para confirmar el handshake');
    }

    const { rows: [updatedRow] } = await db.query(`
        SELECT r.*, u.name as driver_name, u.latitude as driver_latitude, u.longitude as driver_longitude
        FROM pickup_requests r
        LEFT JOIN users u ON r.driver_id = u.id
        WHERE r.id = $1
    `, [requestId]);
    const dto = buildPickupRequestDTO(updatedRow);
    await logAuditEvent({
        requestId: Number(requestId),
        eventType: 'HANDSHAKE_VALIDATED',
        actorId: clientId,
        actorRole: 'CLIENT',
        counterpartyActorId: request.driver_id,
        counterpartyRole: 'DRIVER',
        metadata: {
            clientLat: clientLat ?? null,
            clientLon: clientLon ?? null,
            attemptNumber,
            custodyBlockHash: preparedCommit?.block.blockHash ?? null,
            custodyLedgerHeight: preparedCommit?.block.blockHeight ?? null,
        },
    });

    dto.custodySummary = preparedCommit ? {
        storageMode: 'PERMISSIONED_CUSTODY_LEDGER',
        blockHash: preparedCommit.block.blockHash,
        previousBlockHash: preparedCommit.block.previousBlockHash,
        ledgerHeight: preparedCommit.block.blockHeight,
        quorumProof: preparedCommit.block.validatorCommitCertificate,
    } : null;
    dto.custodyChallenge = null;
    return { dto };
}

// ── d) depositRequest ───────────────────────────────────────────────────────

export async function depositRequest(
    params: {
        requestId: string;
        driverId: number;
        challengeId?: string;
        lockerLabel?: string;
    }
) {
    const { requestId, driverId, challengeId, lockerLabel } = params;
    const now = new Date().toISOString();

    const plainCode = crypto.randomInt(100000, 999999).toString();

    // Calcular medianoche local del área de servicio
    const getEndOfDayLocal = (): string => {
        const tz = 'Atlantic/Canary';
        const nowDate = new Date();
        const localDate = nowDate.toLocaleDateString('en-CA', { timeZone: tz });
        const endOfDay = new Date(`${localDate}T23:59:59`);
        const localEndOfDay = new Date(endOfDay.toLocaleString('en-US', { timeZone: tz }));
        const utcEndOfDay = new Date(endOfDay.getTime() + (endOfDay.getTime() - localEndOfDay.getTime()));
        return utcEndOfDay.toISOString();
    };
    const lockerCodeExpiresAt = getEndOfDayLocal();

    const pgClient = await db.getClient();
    let resultData: {
        lockerCode: string;
        lockerLabel: string;
        lockerId: number;
        clientId: number;
        notification: any;
    };

    try {
        await pgClient.query('BEGIN');

        const { rows: [existing] } = await pgClient.query(
            'SELECT status, driver_id, client_id, package_size FROM pickup_requests WHERE id = $1',
            [requestId]
        );

        if (!existing) {
            await pgClient.query('ROLLBACK');
            throw new ServiceError(404, 'NOT_FOUND', 'Pedido no encontrado');
        }
        if (existing.status !== 'IN_PROGRESS') {
            await pgClient.query('ROLLBACK');
            logger.warn({ requestId, currentStatus: existing.status }, 'Deposit conflict: request not IN_PROGRESS');
            throw new ServiceError(409, 'CONFLICT', 'El pedido no está en estado IN_PROGRESS');
        }
        if (existing.driver_id !== driverId) {
            await pgClient.query('ROLLBACK');
            throw new ServiceError(403, 'FORBIDDEN', 'No estás asignado a este pedido');
        }

        // Para la demo, el locker ya viene asignado desde el inicio (fase create)
        const { rows: [assignedLocker] } = await pgClient.query(
            'SELECT l.* FROM lockers l JOIN pickup_requests r ON r.locker_id = l.id WHERE r.id = $1',
            [requestId]
        );

        const locker = assignedLocker;

        if (!locker) {
            await pgClient.query('ROLLBACK');
            logger.warn({ requestId }, 'No locker assigned to this request');
            throw new ServiceError(409, 'NO_LOCKER_ASSIGNED', 'No hay taquilla asignada a este pedido');
        }

        const encryptedCode = encryptField(plainCode);

        await pgClient.query(`
            UPDATE lockers
            SET is_occupied = TRUE, current_request_id = $1, access_code = $2, updated_at = $3
            WHERE id = $4
        `, [requestId, encryptedCode, now, locker.id]);

        await pgClient.query(`
            UPDATE pickup_requests
            SET status = 'DEPOSITED', locker_id = $1, locker_code = $2, locker_code_expires_at = $3, updated_at = $4
            WHERE id = $5
        `, [locker.id, encryptedCode, lockerCodeExpiresAt, now, requestId]);

        const { rows: [notifRow] } = await pgClient.query(`
            INSERT INTO notifications (user_id, type, title, message, created_at)
            VALUES ($1, 'LOCKER_READY', 'Tu paquete está listo', $2, $3) RETURNING *
        `, [existing.client_id, `Locker ${locker.label}. Código: ${plainCode}`, now]);

        await pgClient.query('COMMIT');

        resultData = {
            lockerCode: plainCode,
            lockerLabel: locker.label,
            lockerId: locker.id,
            clientId: existing.client_id,
            notification: {
                id: notifRow.id,
                userId: notifRow.user_id,
                type: notifRow.type,
                title: notifRow.title,
                message: notifRow.message,
                read: notifRow.read === true,
                createdAt: notifRow.created_at,
            },
        };
    } catch (err) {
        if (err instanceof ServiceError) throw err;
        await pgClient.query('ROLLBACK');
        throw err;
    } finally {
        pgClient.release();
    }

    let preparedCommit: Awaited<ReturnType<typeof prepareCustodyCommit>> | null = null;
    if (challengeId) {
        preparedCommit = await prepareCustodyCommit({
            challengeId,
            eventType: 'DEPOSITED',
            systemAttestationMetadata: [
                {
                    lockerLabel: resultData.lockerLabel,
                    lockerCodeExpiresAt,
                },
            ],
        });

        try {
            await finalizeCustodyCommit(preparedCommit.proposalId);
            await markChallengeCommitted(challengeId);
        } catch (err) {
            await abortCustodyCommit(preparedCommit.proposalId);
            await db.query(`
                UPDATE pickup_requests
                SET status = 'IN_PROGRESS',
                    locker_id = NULL,
                    locker_code = NULL,
                    locker_code_expires_at = NULL,
                    updated_at = $1
                WHERE id = $2
            `, [new Date().toISOString(), requestId]);
            await db.query(`
                UPDATE lockers
                SET is_occupied = FALSE, current_request_id = NULL, access_code = NULL, updated_at = $1
                WHERE id = $2
            `, [new Date().toISOString(), resultData.lockerId]);
            logger.error({
                err,
                requestId,
                challengeId,
                proposalId: preparedCommit.proposalId,
                lockerId: resultData.lockerId,
            }, 'Custody ledger commit failed during deposit; state compensated back to IN_PROGRESS');
            throw err;
        }
    } else if (config.env !== 'test') {
        throw new ServiceError(400, 'CUSTODY_CHALLENGE_REQUIRED', 'Se requiere challenge firmado para confirmar el depósito');
    }

    logger.info({ requestId, locker: resultData.lockerLabel }, 'Request deposited');
    await logAuditEvent({
        requestId: Number(requestId),
        eventType: 'DEPOSITED',
        actorId: driverId,
        actorRole: 'DRIVER',
        counterpartyActorId: resultData.clientId,
        counterpartyRole: 'CLIENT',
        metadata: {
            lockerLabel: resultData.lockerLabel,
            lockerCodeExpiresAt,
            custodyBlockHash: preparedCommit?.block.blockHash ?? null,
            custodyLedgerHeight: preparedCommit?.block.blockHeight ?? null,
        },
    });

    // Hito 5.3.3 — métrica business: request completada con depósito en locker
    requestsCompletedTotal.inc();

    // Hito 5.4.3 — telemetría al twin
    syncRequestDeposited(Number(requestId)).catch(() => {});

    // Notify client: locker ready with PIN (fire-and-forget)
    notifyDepositReady(resultData.clientId, resultData.lockerLabel, resultData.lockerCode).catch(() => {});

    const { rows: [row] } = await db.query(`
        SELECT r.*, l.label as locker_label, u.name as driver_name, u.latitude as driver_latitude, u.longitude as driver_longitude
        FROM pickup_requests r
        LEFT JOIN lockers l ON r.locker_id = l.id
        LEFT JOIN users u ON r.driver_id = u.id
        WHERE r.id = $1
    `, [requestId]);

    const dto = buildPickupRequestDTO(row);
    dto.lockerCode = resultData.lockerCode;
    dto.custodySummary = preparedCommit ? {
        storageMode: 'PERMISSIONED_CUSTODY_LEDGER',
        blockHash: preparedCommit.block.blockHash,
        previousBlockHash: preparedCommit.block.previousBlockHash,
        ledgerHeight: preparedCommit.block.blockHeight,
        quorumProof: preparedCommit.block.validatorCommitCertificate,
    } : null;

    return {
        dto,
        lockerCode: resultData.lockerCode,
        clientId: resultData.clientId,
        notification: resultData.notification,
        locker: dto.locker,
    };
}

// ── renewHandshake ──────────────────────────────────────────────────────────

export async function renewHandshake(
    params: { requestId: string; driverId: number }
) {
    const { requestId, driverId } = params;
    const now = new Date().toISOString();
    const newExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const newCode = crypto.randomInt(1000, 9999).toString();
    const newCodeStore = encryptField(newCode);

    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const { rows: [request] } = await client.query(
            'SELECT * FROM pickup_requests WHERE id = $1', [requestId]
        );
        if (!request) {
            await client.query('ROLLBACK');
            throw new ServiceError(404, 'NOT_FOUND', 'Pedido no encontrado');
        }
        if (request.driver_id !== driverId) {
            await client.query('ROLLBACK');
            throw new ServiceError(403, 'FORBIDDEN', 'No estás asignado a este pedido');
        }
        if (request.status !== 'CONFIRMATION_PENDING') {
            await client.query('ROLLBACK');
            throw new ServiceError(409, 'CONFLICT', 'El pedido no está en espera de confirmación');
        }

        await client.query(`
            UPDATE pickup_requests
            SET handshake_code = $1, handshake_expires_at = $2, updated_at = $3
            WHERE id = $4
        `, [newCodeStore, newExpiresAt, now, requestId]);
        await client.query(
            `UPDATE custody_challenges
             SET status = 'REVOKED', updated_at = $1
             WHERE request_id = $2 AND event_type = 'HANDSHAKE_VALIDATED' AND status = 'PENDING'`,
            [now, requestId],
        );

        await client.query('COMMIT');
    } catch (err) {
        if (err instanceof ServiceError) throw err;
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    logger.info({ requestId, expiresAt: newExpiresAt }, 'Handshake renewed');
    await logAuditEvent({
        requestId: Number(requestId),
        eventType: 'HANDSHAKE_RENEWED',
        actorId: driverId,
        actorRole: 'DRIVER',
    });

    const { rows: [row] } = await db.query(`
        SELECT r.*, u.name as driver_name, u.latitude as driver_latitude, u.longitude as driver_longitude
        FROM pickup_requests r
        LEFT JOIN users u ON r.driver_id = u.id
        WHERE r.id = $1
    `, [requestId]);
    const dto = buildPickupRequestDTO(row);

    return { dto, newCode };
}

// ── e) getClientRequests ────────────────────────────────────────────────────

export async function getClientCurrent(params: { userId: number }) {
    const { rows: [row] } = await db.query(`
        SELECT r.*, l.label as locker_label, u.name as driver_name, u.latitude as driver_latitude, u.longitude as driver_longitude
        FROM pickup_requests r
        LEFT JOIN lockers l ON r.locker_id = l.id
        LEFT JOIN users u ON r.driver_id = u.id
        WHERE r.client_id = $1 AND r.status != 'PICKED_UP'
        ORDER BY r.created_at DESC
        LIMIT 1
    `, [params.userId]);

    if (!row) return null;

    const dto = buildPickupRequestDTO(row);
    dto.handshakeCode = null;
    if (dto.status !== 'DEPOSITED') {
        dto.lockerCode = null;
    } else {
        dto.lockerCode = decryptField(dto.lockerCode);
    }
    return attachCustodyState(dto);
}

export async function getClientHistory(params: { userId: number }) {
    const { rows } = await db.query(`
        SELECT r.*, l.label as locker_label, u.name as driver_name, u.latitude as driver_latitude, u.longitude as driver_longitude
        FROM pickup_requests r
        LEFT JOIN lockers l ON r.locker_id = l.id
        LEFT JOIN users u ON r.driver_id = u.id
        WHERE r.client_id = $1
        ORDER BY r.created_at DESC
    `, [params.userId]);

    return Promise.all(rows.map(async (row: any) => {
        const dto = buildPickupRequestDTO(row);
        dto.handshakeCode = null;
        if (dto.status !== 'DEPOSITED') {
            dto.lockerCode = null;
        } else {
            dto.lockerCode = decryptField(dto.lockerCode);
        }
        return attachCustodyState(dto);
    }));
}

// ── getPendingRequests ──────────────────────────────────────────────────────

export async function getPendingRequests(
    params: { driverId: number; lat?: number | null; lon?: number | null; radius?: number | null }
) {
    const { lat, lon, radius, driverId } = params;

    // Si hay coordenadas válidas, filtrar con PostGIS ST_DWithin
    if (lat != null && lon != null && radius != null && !isNaN(lat) && !isNaN(lon) && !isNaN(radius)) {
        logger.debug({ driverId, lat, lon, radiusKm: radius }, 'Filtering pending requests by PostGIS');

        const { rows } = await db.query(`
            SELECT *,
                   CASE WHEN pickup_location_geo IS NOT NULL
                        THEN ST_Distance(
                               pickup_location_geo,
                               ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
                             ) / 1000.0
                        ELSE NULL
                   END AS distance_km
            FROM pickup_requests
            WHERE status = 'REQUESTED'
              AND (
                pickup_location_geo IS NULL
                OR ST_DWithin(
                     pickup_location_geo,
                     ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                     $3 * 1000
                   )
              )
            ORDER BY distance_km ASC NULLS LAST
        `, [lon, lat, radius]);

        return rows.map((row: any) => buildPickupRequestDTO(row));
    }

    // Sin coordenadas: devolver todos los pedidos pendientes
    const { rows } = await db.query(`
        SELECT * FROM pickup_requests
        WHERE status = 'REQUESTED'
        ORDER BY created_at DESC
    `);

    return rows.map((row: any) => buildPickupRequestDTO(row));
}

// ── getDriverPickups ────────────────────────────────────────────────────────

export async function getDriverPickups(params: { driverId: number }) {
    const { rows } = await db.query(`
        SELECT r.*, l.label as locker_label, u.name as driver_name, u.latitude as driver_latitude, u.longitude as driver_longitude
        FROM pickup_requests r
        LEFT JOIN lockers l ON r.locker_id = l.id
        LEFT JOIN users u ON r.driver_id = u.id
        WHERE r.driver_id = $1 AND r.status IN ('CONFIRMATION_PENDING', 'IN_PROGRESS', 'DEPOSITED', 'PICKED_UP')
        ORDER BY r.updated_at DESC
    `, [params.driverId]);

    return Promise.all(rows.map(async (row: any) => {
        const dto = buildPickupRequestDTO(row);
        dto.handshakeCode = dto.status === 'CONFIRMATION_PENDING'
            ? decryptField(dto.handshakeCode)
            : null;
        if (dto.status !== 'DEPOSITED') {
            dto.lockerCode = null;
        } else {
            dto.lockerCode = decryptField(dto.lockerCode);
        }
        return attachCustodyState(dto);
    }));
}
