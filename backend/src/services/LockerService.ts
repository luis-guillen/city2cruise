import { db } from '../db/database';
import { buildPickupRequestDTO } from '../utils/dto';
import { logAuditEvent } from './AuditService';
import { logger } from '../utils/logger';
import { ServiceError } from '../utils/errors';
import { decryptField } from '../utils/crypto';

// ── a) openLocker ────────────────────────────────────────────────────────────

export async function openLocker(
    params: { lockerCode: string; userId: number; userName: string }
) {
    const { lockerCode, userId, userName } = params;
    const now = new Date().toISOString();

    const { rows: depositedRows } = await db.query(`
        SELECT r.*, l.label as locker_label FROM pickup_requests r
        LEFT JOIN lockers l ON r.locker_id = l.id
        WHERE r.client_id = $1 AND r.status = 'DEPOSITED'
    `, [userId]);

    let matchedRow: any = null;
    for (const row of depositedRows) {
        if (row.locker_code && decryptField(row.locker_code) === lockerCode) {
            matchedRow = row;
            break;
        }
    }

    if (!matchedRow) {
        logger.warn({ client: userName }, 'Locker open failed: invalid code or already opened');
        throw new ServiceError(409, 'CONFLICT', 'Código inválido o taquilla no lista para apertura.');
    }

    if (!matchedRow.locker_code_expires_at || new Date() >= new Date(matchedRow.locker_code_expires_at)) {
        logger.warn({ requestId: matchedRow.id, expiresAt: matchedRow.locker_code_expires_at }, 'Locker code expired');
        throw new ServiceError(410, 'OTP_EXPIRED', 'Código de locker expirado. Contacte soporte.');
    }

    // Transacción manual con pg
    const client = await db.getClient();
    try {
        await client.query('BEGIN');

        const { rows: [current] } = await client.query(
            'SELECT status FROM pickup_requests WHERE id = $1', [matchedRow.id]
        );
        if (!current || current.status !== 'DEPOSITED') {
            await client.query('ROLLBACK');
            throw new ServiceError(409, 'CONFLICT', 'Código inválido o taquilla no lista para apertura.');
        }

        await client.query(`
            UPDATE pickup_requests
            SET status = 'PICKED_UP', updated_at = $1
            WHERE id = $2 AND status = 'DEPOSITED'
        `, [now, matchedRow.id]);

        await client.query(`
            UPDATE lockers
            SET is_occupied = FALSE, current_request_id = NULL, access_code = NULL, updated_at = $1
            WHERE id = $2
        `, [now, matchedRow.locker_id]);

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    logger.info({ requestId: matchedRow.id, locker: matchedRow.locker_label }, 'Locker opened');
    await logAuditEvent({ requestId: matchedRow.id, eventType: 'PICKED_UP', actorId: userId });

    const { rows: [row] } = await db.query(`
        SELECT r.*, l.label as locker_label, u.name as driver_name, u.latitude as driver_latitude, u.longitude as driver_longitude
        FROM pickup_requests r
        LEFT JOIN lockers l ON r.locker_id = l.id
        LEFT JOIN users u ON r.driver_id = u.id
        WHERE r.id = $1
    `, [matchedRow.id]);

    const dto = buildPickupRequestDTO(row);
    return { dto };
}

// ── b) getAvailableLockers ───────────────────────────────────────────────────

export async function getAvailableLockers(params: { sizeCategory?: string } = {}) {
    if (params.sizeCategory) {
        const { rows } = await db.query(
            'SELECT * FROM lockers WHERE is_occupied = FALSE AND size_category = $1 ORDER BY id ASC',
            [params.sizeCategory]
        );
        return rows;
    }
    const { rows } = await db.query('SELECT * FROM lockers WHERE is_occupied = FALSE ORDER BY id ASC');
    return rows;
}
