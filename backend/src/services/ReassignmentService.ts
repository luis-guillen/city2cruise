import { db } from '../db/database';
import { emitToUser } from '../sockets/io';
import { buildPickupRequestDTO, sanitizeForSocket } from '../utils/dto';
import { logger } from '../utils/logger';

export interface ReassignParams {
    requestId: number;
    newCandidateIds: number[];
}

export interface ReassignResult {
    reassigned: boolean;
    reason?: 'not_found' | 'not_in_requested_state';
    cancelledOfferCount?: number;
    newCandidateCount?: number;
}

const pendingOfferDriverIdsByRequest = new Map<number, Set<number>>();

export function registerPendingOffers(requestId: number, driverIds: number[]): void {
    const validIds = driverIds.filter((id) => Number.isInteger(id) && id > 0);
    if (validIds.length === 0) return;

    const existing = pendingOfferDriverIdsByRequest.get(requestId) ?? new Set<number>();
    for (const driverId of validIds) existing.add(driverId);
    pendingOfferDriverIdsByRequest.set(requestId, existing);
}

export function replacePendingOffers(requestId: number, driverIds: number[]): void {
    const validIds = [...new Set(driverIds.filter((id) => Number.isInteger(id) && id > 0))];
    if (validIds.length === 0) {
        pendingOfferDriverIdsByRequest.delete(requestId);
        return;
    }
    pendingOfferDriverIdsByRequest.set(requestId, new Set(validIds));
}

export function clearPendingOffers(requestId: number): void {
    pendingOfferDriverIdsByRequest.delete(requestId);
}

export function getPendingOfferDriverIds(requestId: number): number[] {
    return [...(pendingOfferDriverIdsByRequest.get(requestId) ?? new Set<number>())];
}

export function _resetPendingOffersForTests(): void {
    pendingOfferDriverIdsByRequest.clear();
}

export async function reassignRequest(params: ReassignParams): Promise<ReassignResult> {
    const { requestId } = params;
    const newCandidateIds = [...new Set(params.newCandidateIds.filter((id) => Number.isInteger(id) && id > 0))];
    const previousCandidateIds = getPendingOfferDriverIds(requestId);

    const client = await db.getClient();
    let safeDto: Record<string, unknown> = { requestId, viaRebalance: true };

    try {
        await client.query('BEGIN');

        const { rows } = await client.query<{ status: string }>(
            'SELECT status FROM pickup_requests WHERE id = $1 FOR UPDATE',
            [requestId],
        );

        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return { reassigned: false, reason: 'not_found' };
        }

        if (rows[0].status !== 'REQUESTED') {
            await client.query('ROLLBACK');
            return { reassigned: false, reason: 'not_in_requested_state' };
        }

        const requestResult = await client.query(
            `SELECT r.*, u.name AS driver_name, u.latitude AS driver_latitude, u.longitude AS driver_longitude,
                    l.label AS locker_label
             FROM pickup_requests r
             LEFT JOIN users u ON u.id = r.driver_id
             LEFT JOIN lockers l ON l.id = r.locker_id
             WHERE r.id = $1`,
            [requestId],
        );

        if (requestResult.rows[0]) {
            safeDto = {
                ...sanitizeForSocket(buildPickupRequestDTO(requestResult.rows[0])),
                viaRebalance: true,
            };
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    for (const driverId of previousCandidateIds) {
        emitToUser(driverId, 'pickup:offer:cancelled', { requestId, reason: 'rebalanced' });
    }

    replacePendingOffers(requestId, newCandidateIds);

    for (const driverId of newCandidateIds) {
        emitToUser(driverId, 'new:pickup:request', safeDto);
    }

    logger.info(
        {
            requestId,
            cancelledOfferCount: previousCandidateIds.length,
            newCandidateCount: newCandidateIds.length,
        },
        '[REASSIGN] request rebalanced',
    );

    return {
        reassigned: true,
        cancelledOfferCount: previousCandidateIds.length,
        newCandidateCount: newCandidateIds.length,
    };
}
