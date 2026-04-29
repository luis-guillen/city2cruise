import request from 'supertest';
import { createTestApp, getAdminToken, getTestPool, setupTestDb, teardownTestDb } from './helpers';

jest.mock('../db/database', () => {
    const actual = jest.requireActual('../db/database');
    return { ...actual, initDB: jest.fn() };
});

jest.mock('../sockets/io', () => ({
    emitEvent: jest.fn(),
    emitToUser: jest.fn(),
    emitToSocket: jest.fn(),
    initSockets: jest.fn(),
    getActiveDrivers: jest.fn(() => []),
}));

jest.mock('../services/twin/TwinSyncService', () => {
    const actual = jest.requireActual('../services/twin/TwinSyncService');
    return {
        ...actual,
        syncRequestAssigned: jest.fn(async () => undefined),
        syncRequestCancelled: jest.fn(async () => undefined),
    };
});

let app: any;

beforeAll(async () => {
    await setupTestDb();
    app = createTestApp();
});

afterAll(async () => {
    await teardownTestDb();
});

describe('POST /api/admin/intervention/cancel', () => {
    it('cancels a REQUESTED request, releases locker and emits twin sync', async () => {
        const pool = getTestPool();
        const now = new Date().toISOString();
        const { rows: [inserted] } = await pool.query(
            `INSERT INTO pickup_requests
                (client_id, pickup_location, status, locker_id, created_at, updated_at)
             VALUES ($1, $2, 'REQUESTED', $3, $4, $5)
             RETURNING id`,
            [1, 'Puerto BCN', 1, now, now],
        );
        await pool.query(
            `UPDATE lockers
             SET is_occupied = TRUE, current_request_id = $1, updated_at = $2
             WHERE id = 1`,
            [inserted.id, now],
        );

        const res = await request(app)
            .post('/api/admin/intervention/cancel')
            .set('Authorization', `Bearer ${getAdminToken()}`)
            .send({ requestId: inserted.id, reason: 'manual_override' });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ ok: true, requestId: inserted.id, status: 'CANCELLED' });

        const { rows: [requestRow] } = await pool.query(
            'SELECT status, driver_id FROM pickup_requests WHERE id = $1',
            [inserted.id],
        );
        expect(requestRow.status).toBe('CANCELLED');
        expect(requestRow.driver_id).toBeNull();

        const { rows: [lockerRow] } = await pool.query(
            'SELECT is_occupied, current_request_id FROM lockers WHERE id = 1',
        );
        expect(lockerRow.is_occupied).toBe(false);
        expect(lockerRow.current_request_id).toBeNull();

        const { syncRequestCancelled } = jest.requireMock('../services/twin/TwinSyncService');
        expect(syncRequestCancelled).toHaveBeenCalledWith(inserted.id, 'manual_override');
    });
});

describe('POST /api/admin/intervention/force-assign', () => {
    it('force-assigns a driver through the existing accept flow', async () => {
        const pool = getTestPool();
        const now = new Date().toISOString();
        const { rows: [inserted] } = await pool.query(
            `INSERT INTO pickup_requests
                (client_id, pickup_location, status, created_at, updated_at)
             VALUES ($1, $2, 'REQUESTED', $3, $4)
             RETURNING id`,
            [1, 'Terminal ferry', now, now],
        );

        const res = await request(app)
            .post('/api/admin/intervention/force-assign')
            .set('Authorization', `Bearer ${getAdminToken()}`)
            .send({ requestId: inserted.id, driverId: 2 });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.request).toMatchObject({
            id: inserted.id,
            status: 'CONFIRMATION_PENDING',
            driver: { id: 2, name: 'Test Driver' },
        });

        const { rows: [requestRow] } = await pool.query(
            'SELECT status, driver_id, handshake_code FROM pickup_requests WHERE id = $1',
            [inserted.id],
        );
        expect(requestRow.status).toBe('CONFIRMATION_PENDING');
        expect(requestRow.driver_id).toBe(2);
        expect(requestRow.handshake_code).toBeTruthy();
    });
});
