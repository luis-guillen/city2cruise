/**
 * Tests de la ruta /api/merchants
 */
import request from 'supertest';
import { setupTestDb, teardownTestDb, createTestApp, getTestPool } from './helpers';
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
const clientToken = generateToken({ id: 1, name: 'Client', role: 'CLIENT' });

beforeAll(async () => {
    await setupTestDb();
    app = createTestApp();
});

afterAll(async () => {
    await teardownTestDb();
});

describe('POST /api/merchants/register', () => {
    it('crea un merchant correctamente (admin)', async () => {
        const res = await request(app)
            .post('/api/merchants/register')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ business_name: 'Tienda LPA', email: 'tienda@lpa.com', phone: '600000001' });
        expect(res.status).toBe(201);
        expect(res.body.business_name).toBe('Tienda LPA');
        expect(res.body.email).toBe('tienda@lpa.com');
        expect(res.body.integration_status).toBe('pending');
    });

    it('rechaza registro sin autenticación', async () => {
        const res = await request(app)
            .post('/api/merchants/register')
            .send({ business_name: 'Sin Auth', email: 'sinauth@test.com' });
        expect(res.status).toBe(401);
    });

    it('rechaza registro sin business_name', async () => {
        const res = await request(app)
            .post('/api/merchants/register')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ email: 'sin-nombre@test.com' });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('BAD_REQUEST');
    });

    it('rechaza email inválido', async () => {
        const res = await request(app)
            .post('/api/merchants/register')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ business_name: 'Test', email: 'not-an-email' });
        expect(res.status).toBe(400);
    });

    it('rechaza email duplicado', async () => {
        await request(app)
            .post('/api/merchants/register')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ business_name: 'Dup A', email: 'duplicado@test.com' });
        const res = await request(app)
            .post('/api/merchants/register')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ business_name: 'Dup B', email: 'duplicado@test.com' });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('EMAIL_CONFLICT');
    });
});

describe('GET /api/merchants', () => {
    it('retorna lista para admin', async () => {
        const res = await request(app)
            .get('/api/merchants')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
    });

    it('rechaza acceso sin token', async () => {
        const res = await request(app).get('/api/merchants');
        expect(res.status).toBe(401);
    });

    it('rechaza acceso con token de cliente', async () => {
        const res = await request(app)
            .get('/api/merchants')
            .set('Authorization', `Bearer ${clientToken}`);
        expect(res.status).toBe(403);
    });
});

describe('GET /api/merchants/nearby', () => {
    beforeAll(async () => {
        const pool = getTestPool();
        const now = new Date().toISOString();
        await pool.query(
            `INSERT INTO merchants (business_name, email, latitude, longitude, location, integration_status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, 'active', $5, $5)`,
            ['Porto Shop', 'porto@shop.com', 28.141, -15.431, now]
        );
        await pool.query(
            `INSERT INTO merchants (business_name, email, latitude, longitude, location, integration_status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, 'active', $5, $5)`,
            ['Madrid Shop', 'madrid@shop.com', 40.416, -3.703, now]
        );
    });

    it('retorna merchants dentro del radio', async () => {
        const res = await request(app)
            .get('/api/merchants/nearby?lat=28.141&lon=-15.431&radius=1')
            .set('Authorization', `Bearer ${clientToken}`);
        expect(res.status).toBe(200);
        const names = res.body.map((m: any) => m.business_name);
        expect(names).toContain('Porto Shop');
        expect(names).not.toContain('Madrid Shop');
    });

    it('excluye merchants fuera del radio', async () => {
        const res = await request(app)
            .get('/api/merchants/nearby?lat=28.141&lon=-15.431&radius=0.1')
            .set('Authorization', `Bearer ${clientToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    it('retorna 400 si faltan coordenadas', async () => {
        const res = await request(app)
            .get('/api/merchants/nearby?radius=2')
            .set('Authorization', `Bearer ${clientToken}`);
        expect(res.status).toBe(400);
    });
});

describe('PUT /api/merchants/:id/status', () => {
    let merchantId: number;

    beforeAll(async () => {
        const pool = getTestPool();
        const now = new Date().toISOString();
        const { rows: [row] } = await pool.query(
            `INSERT INTO merchants (business_name, email, integration_status, created_at, updated_at)
             VALUES ('Status Test', 'status@test.com', 'pending', $1, $1) RETURNING id`,
            [now]
        );
        merchantId = row.id;
    });

    it('actualiza el estado a active', async () => {
        const res = await request(app)
            .put(`/api/merchants/${merchantId}/status`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ integration_status: 'active' });
        expect(res.status).toBe(200);
        expect(res.body.integration_status).toBe('active');
    });

    it('actualiza el estado a suspended', async () => {
        const res = await request(app)
            .put(`/api/merchants/${merchantId}/status`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ integration_status: 'suspended' });
        expect(res.status).toBe(200);
        expect(res.body.integration_status).toBe('suspended');
    });

    it('rechaza estado inválido', async () => {
        const res = await request(app)
            .put(`/api/merchants/${merchantId}/status`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ integration_status: 'unknown' });
        expect(res.status).toBe(400);
    });

    it('retorna 404 para merchant inexistente', async () => {
        const res = await request(app)
            .put('/api/merchants/99999/status')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ integration_status: 'active' });
        expect(res.status).toBe(404);
    });
});
