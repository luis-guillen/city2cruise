import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
    reassignRequest,
    replacePendingOffers,
    getPendingOfferDriverIds,
    _resetPendingOffersForTests,
} from '../services/ReassignmentService';
import { db } from '../db/database';
import { emitToUser } from '../sockets/io';

jest.mock('../db/database', () => ({
    db: {
        getClient: jest.fn(),
    },
}));

jest.mock('../sockets/io', () => ({
    emitToUser: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
}));

describe('ReassignmentService.reassignRequest', () => {
    const query: any = jest.fn();
    const release: any = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        _resetPendingOffersForTests();
        (db.getClient as any).mockResolvedValue({ query, release });
    });

    it('refuses to reassign if request is no longer REQUESTED', async () => {
        query
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ rows: [{ status: 'ASSIGNED' }] })
            .mockResolvedValueOnce({});

        const result = await reassignRequest({ requestId: 1, newCandidateIds: [10, 11] });

        expect(result.reassigned).toBe(false);
        expect(result.reason).toBe('not_in_requested_state');
        expect(emitToUser).not.toHaveBeenCalled();
    });

    it('cancels old offers and emits new:pickup:request to new candidates', async () => {
        replacePendingOffers(1, [99, 100]);
        query
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({ rows: [{ status: 'REQUESTED' }] })
            .mockResolvedValueOnce({
                rows: [{
                    id: 1,
                    client_id: 7,
                    driver_id: null,
                    pickup_location: 'Puerto',
                    latitude: 28.12,
                    longitude: -15.43,
                    package_size: 'SMALL',
                    status: 'REQUESTED',
                    locker_id: 3,
                    locker_label: 'L-003',
                    created_at: '2026-04-29T10:00:00.000Z',
                    updated_at: '2026-04-29T10:00:00.000Z',
                }],
            })
            .mockResolvedValueOnce({});

        const result = await reassignRequest({ requestId: 1, newCandidateIds: [10, 11] });

        expect(result.reassigned).toBe(true);
        expect(result.cancelledOfferCount).toBe(2);
        expect(emitToUser).toHaveBeenCalledWith(99, 'pickup:offer:cancelled', { requestId: 1, reason: 'rebalanced' });
        expect(emitToUser).toHaveBeenCalledWith(100, 'pickup:offer:cancelled', { requestId: 1, reason: 'rebalanced' });
        expect(emitToUser).toHaveBeenCalledWith(10, 'new:pickup:request', expect.objectContaining({ id: 1, viaRebalance: true }));
        expect(emitToUser).toHaveBeenCalledWith(11, 'new:pickup:request', expect.objectContaining({ id: 1, viaRebalance: true }));
        expect(getPendingOfferDriverIds(1)).toEqual([10, 11]);
    });
});
