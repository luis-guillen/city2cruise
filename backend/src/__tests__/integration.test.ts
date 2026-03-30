/**
 * Tests de Integración: Flujo Completo
 * 
 * Simula el ciclo de vida completo de un pedido:
 * Login → Crear Request → Accept → Deposit → Open Locker → Verificar PICKED_UP
 * 
 * Usa una base de datos PostgreSQL de test para aislar cada suite de tests.
 */
import request from 'supertest';
import {
    setupTestDb,
    teardownTestDb,
    createTestApp,
    getClientToken,
    getDriverToken,
} from './helpers';

// Mock del emisor de sockets para que no falle al no haber servidor HTTP real
jest.mock('../sockets/io', () => ({
    emitEvent: jest.fn(),
    emitToUser: jest.fn(),
    emitToSocket: jest.fn(),
    initSockets: jest.fn(),
    getActiveDrivers: jest.fn(() => []),
}));

// Mock de initDB para que no intente reinicializar la DB al cargar el módulo
jest.mock('../db/database', () => {
    const actual = jest.requireActual('../db/database');
    return { ...actual, initDB: jest.fn() };
});

// ─── SETUP / TEARDOWN ─────────────────────────────────────────────────────

let app: any;
let clientToken: string;
let driverToken: string;

beforeAll(async () => {
    await setupTestDb();
    app = createTestApp();
    clientToken = getClientToken();
    driverToken = getDriverToken();
});

afterAll(async () => {
    await teardownTestDb();
});

// ─── TESTS ─────────────────────────────────────────────────────────────────

describe('Flujo Completo de Integración', () => {
    let requestId: number;
    let lockerCode: string;
    let handshakeCode: string;

    // ── 1. Health Check ────────────────────────────────────────────────────

    it('GET /api/health devuelve 200 OK', async () => {
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('OK');
    });

    // ── 2. Autenticación ───────────────────────────────────────────────────

    it('POST /api/auth/login devuelve token y usuario para CLIENT', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'client@test.com', password: 'password123' });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('token');
        expect(res.body.user.name).toBe('Test Client');
        expect(res.body.user.role).toBe('CLIENT');
    });

    it('POST /api/auth/login devuelve token y usuario para DRIVER', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'driver@test.com', password: 'password123' });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('token');
        expect(res.body.user.name).toBe('Test Driver');
    });

    // ── 3. Crear Request (CLIENT) ──────────────────────────────────────────

    it('POST /api/requests crea un pedido con estado REQUESTED', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ pickupLocation: 'Terminal Puerto de La Luz, Las Palmas', packageSize: 'SMALL' });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('REQUESTED');
        expect(res.body.pickupLocation).toBe('Terminal Puerto de La Luz, Las Palmas');
        expect(res.body.clientId).toBe(1);
        requestId = res.body.id;
    });

    // ── 4. Listar Pendientes (DRIVER) ──────────────────────────────────────

    it('GET /api/requests/pending devuelve el pedido recién creado', async () => {
        const res = await request(app)
            .get('/api/requests/pending?lat=28.14&lon=-15.43&radius=100')
            .set('Authorization', `Bearer ${driverToken}`);

        expect(res.status).toBe(200);
        expect(res.body).toBeInstanceOf(Array);
        expect(res.body.length).toBeGreaterThanOrEqual(1);
        expect(res.body[0].id).toBe(requestId);
    });

    // ── 5. Aceptar Request (DRIVER) ────────────────────────────────────────

    it('POST /api/requests/:id/accept cambia estado a CONFIRMATION_PENDING', async () => {
        const res = await request(app)
            .post(`/api/requests/${requestId}/accept`)
            .set('Authorization', `Bearer ${driverToken}`);

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('CONFIRMATION_PENDING');
        expect(res.body.driverId).toBe(2);
        handshakeCode = res.body.handshakeCode;
    });

    // ── 5b. Confirmar conductor (CLIENT) ───────────────────────────────────

    it('POST /api/requests/:id/confirm-driver confirma conductor y avanza a IN_PROGRESS', async () => {
        const res = await request(app)
            .post(`/api/requests/${requestId}/confirm-driver`)
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ handshakeCode });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('IN_PROGRESS');
    });

    // ── 6. Depositar (DRIVER) ──────────────────────────────────────────────

    it('POST /api/requests/:id/deposit cambia estado a DEPOSITED y genera código', async () => {
        const res = await request(app)
            .post(`/api/requests/${requestId}/deposit`)
            .set('Authorization', `Bearer ${driverToken}`)
            .send({});

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('DEPOSITED');
        expect(res.body.lockerCode).toBeDefined();
        expect(res.body.lockerCode).toHaveLength(6);
        expect(res.body.locker).toBeDefined();
        expect(res.body.locker.label).toMatch(/^T-/);
        lockerCode = res.body.lockerCode;
    });

    // ── 7. Obtener Mi Request (CLIENT) ─────────────────────────────────────

    it('GET /api/requests/mine devuelve el request activo con lockerCode', async () => {
        const res = await request(app)
            .get('/api/requests/mine')
            .set('Authorization', `Bearer ${clientToken}`);

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('DEPOSITED');
        expect(res.body.lockerCode).not.toBeNull();
    });

    // ── 8. Abrir Locker (CLIENT) ───────────────────────────────────────────

    it('POST /api/lockers/open marca estado PICKED_UP y libera locker', async () => {
        const res = await request(app)
            .post('/api/lockers/open')
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ lockerCode });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('PICKED_UP');
    });

    // ── 9. Abrir Locker 2ª vez → 409 CONFLICT ─────────────────────────────

    it('POST /api/lockers/open con mismo código devuelve 409', async () => {
        const res = await request(app)
            .post('/api/lockers/open')
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ lockerCode });

        expect(res.status).toBe(409);
    });

    // ── 10. Verificación final: no queda request activo para el cliente ────

    it('GET /api/requests/mine devuelve null tras PICKED_UP', async () => {
        const res = await request(app)
            .get('/api/requests/mine')
            .set('Authorization', `Bearer ${clientToken}`);

        expect(res.status).toBe(200);
        expect(res.body).toBeNull();
    });
});
