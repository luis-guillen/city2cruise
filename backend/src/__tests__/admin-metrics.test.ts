/**
 * Tests de métricas de admin y audit trail
 */
import request from 'supertest';
import { setupTestDb, teardownTestDb, createTestApp, getClientToken, getDriverToken, getTestPool } from './helpers';
import { generateToken } from '../auth/jwt';

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

let app: any;
const adminToken = generateToken({ id: 99, name: 'Admin', role: 'ADMIN' });
const clientToken = getClientToken();
const driverToken = getDriverToken();

beforeAll(async () => {
    await setupTestDb();
    app = createTestApp();

    const pool = getTestPool();
    const now = new Date().toISOString();
    await pool.query(
        `INSERT INTO pickup_requests (client_id, pickup_location, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [1, 'Test Location', 'PICKED_UP', now, now]
    );
});

afterAll(async () => {
    await teardownTestDb();
});

describe('GET /api/admin/metrics/throughput', () => {
    it('retorna estructura correcta para admin', async () => {
        const res = await request(app)
            .get('/api/admin/metrics/throughput')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(typeof res.body.total_requests).toBe('number');
        expect(typeof res.body.lockers_total).toBe('number');
        expect(typeof res.body.lockers_available).toBe('number');
        expect(typeof res.body.lockers_occupied).toBe('number');
        expect(typeof res.body.occupancy_rate).toBe('number');
        expect(res.body.by_status).toBeDefined();
        expect(res.body.total_requests).toBeGreaterThanOrEqual(1);
    });

    it('rechaza sin token', async () => {
        const res = await request(app).get('/api/admin/metrics/throughput');
        expect(res.status).toBe(401);
    });

    it('rechaza con token de cliente', async () => {
        const res = await request(app)
            .get('/api/admin/metrics/throughput')
            .set('Authorization', `Bearer ${clientToken}`);
        expect(res.status).toBe(403);
    });
});

describe('GET /api/admin/metrics/timing', () => {
    it('retorna estructura correcta', async () => {
        const res = await request(app)
            .get('/api/admin/metrics/timing')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(typeof res.body.requests_today).toBe('number');
        expect(typeof res.body.requests_this_week).toBe('number');
        expect('avg_assignment_time_seconds' in res.body).toBe(true);
        expect('avg_delivery_time_seconds' in res.body).toBe(true);
        expect('avg_total_time_seconds' in res.body).toBe(true);
    });

    it('rechaza sin token admin', async () => {
        const res = await request(app)
            .get('/api/admin/metrics/timing')
            .set('Authorization', `Bearer ${driverToken}`);
        expect(res.status).toBe(403);
    });
});

describe('GET /api/admin/fleet-status', () => {
    it('retorna contadores de conductores', async () => {
        const res = await request(app)
            .get('/api/admin/fleet-status')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(typeof res.body.total_drivers).toBe('number');
        expect(typeof res.body.active_drivers).toBe('number');
        expect(typeof res.body.on_delivery).toBe('number');
        expect(typeof res.body.available).toBe('number');
        expect(res.body.total_drivers).toBe(2);
    });

    it('available = total_drivers - on_delivery', async () => {
        const res = await request(app)
            .get('/api/admin/fleet-status')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.body.available).toBe(res.body.total_drivers - res.body.on_delivery);
    });
});

describe('GET /api/admin/audit-trail/:requestId', () => {
    let reqId: number;

    beforeAll(async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ pickupLocation: 'Puerto', latitude: 28.14, longitude: -15.43, packageSize: 'SMALL' });
        reqId = res.body.id;
        await new Promise(r => setTimeout(r, 50));
    });

    it('retorna eventos de auditoría para una solicitud', async () => {
        const res = await request(app)
            .get(`/api/admin/audit-trail/${reqId}`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
        expect(res.body[0].event_type).toBe('REQUESTED');
    });

    it('retorna array vacío para request sin eventos', async () => {
        const res = await request(app)
            .get('/api/admin/audit-trail/99999')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });
});

describe('GET /api/admin/audit-trail (paginado)', () => {
    it('retorna lista de eventos recientes con paginación', async () => {
        const res = await request(app)
            .get('/api/admin/audit-trail')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.events)).toBe(true);
        expect(typeof res.body.total).toBe('number');
        expect(res.body.page).toBe(1);
    });

    it('rechaza sin token admin', async () => {
        const res = await request(app)
            .get('/api/admin/audit-trail')
            .set('Authorization', `Bearer ${clientToken}`);
        expect(res.status).toBe(403);
    });
});
