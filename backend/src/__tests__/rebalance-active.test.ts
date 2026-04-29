import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { runRebalanceJob } from '../jobs/rebalanceFleetJob';
import { db } from '../db/database';
import { reassignRequest } from '../services/ReassignmentService';
import { emitEvent, emitToUser } from '../sockets/io';

jest.mock('../db/database', () => ({
    db: {
        query: jest.fn(),
    },
}));

jest.mock('../services/telemetry/StateFusion', () => ({
    buildStateTensor: (jest.fn() as any).mockResolvedValue({}),
}));

jest.mock('../services/RLDispatchService', () => ({
    getRLDriverRanking: (jest.fn() as any).mockResolvedValue([
        { driverId: 10, score: 0.99, rank: 0 },
        { driverId: 11, score: 0.95, rank: 1 },
        { driverId: 12, score: 0.9, rank: 2 },
    ]),
}));

jest.mock('../services/ReassignmentService', () => ({
    reassignRequest: (jest.fn() as any).mockResolvedValue({ reassigned: true }),
}));

jest.mock('../sockets/io', () => ({
    emitEvent: jest.fn(),
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

describe('rebalanceFleetJob (active mode)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.RL_REBALANCE_ACTIVE;
    });

    it('does NOT call reassignRequest when RL_REBALANCE_ACTIVE != true', async () => {
        (db.query as any).mockResolvedValue({
            rows: [{
                id: 1,
                clientId: 9,
                createdAt: new Date(Date.now() - 5 * 60_000),
                pickupLocation: 'Port',
            }],
        });

        await runRebalanceJob();

        expect(emitEvent).toHaveBeenCalledWith('dispatch:rebalance:suggested', expect.any(Object));
        expect(reassignRequest).not.toHaveBeenCalled();
        expect(emitToUser).toHaveBeenCalledWith(9, 'request:stale', expect.objectContaining({ requestId: 1 }));
    });

    it('calls reassignRequest for stale requests when flag is true', async () => {
        process.env.RL_REBALANCE_ACTIVE = 'true';
        (db.query as any).mockResolvedValue({
            rows: [{
                id: 1,
                clientId: 9,
                createdAt: new Date(Date.now() - 5 * 60_000),
                pickupLocation: 'Port',
            }],
        });

        await runRebalanceJob();

        expect(reassignRequest).toHaveBeenCalledWith({
            requestId: 1,
            newCandidateIds: [10, 11, 12],
        });
    });
});
