/**
 * Tests de Integración: Flujo Completo
 * 
 * Simula el ciclo de vida completo de un pedido:
 * Login → Crear Request → Accept → Deposit → Open Locker → Verificar PICKED_UP
 * 
 * Usa una base de datos PostgreSQL de test para aislar cada suite de tests.
 */
import request from 'supertest';
import crypto from 'crypto';
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
let clientKeyPair: any;
let driverKeyPair: any;

async function exportPublicKeyJwk(key: any): Promise<JsonWebKey> {
    return crypto.webcrypto.subtle.exportKey('jwk', key);
}

async function signMessage(key: any, message: string): Promise<string> {
    const sig = await crypto.webcrypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        new TextEncoder().encode(message),
    );
    return Buffer.from(sig).toString('base64url');
}

beforeAll(async () => {
    await setupTestDb();
    app = createTestApp();
    clientToken = getClientToken();
    driverToken = getDriverToken();
    clientKeyPair = await crypto.webcrypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
    );
    driverKeyPair = await crypto.webcrypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
    );
});

afterAll(async () => {
    await teardownTestDb();
});

// ─── TESTS ─────────────────────────────────────────────────────────────────

describe('Flujo Completo de Integración', () => {
    let requestId: number;
    let lockerCode: string;
    let handshakeCode: string;
    let handshakeChallengeId: string;

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

    it('POST /api/custody/signing-key/register registra claves criptográficas para cliente y conductor', async () => {
        const clientRes = await request(app)
            .post('/api/custody/signing-key/register')
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ algorithm: 'ECDSA_P256_SHA256', publicKeyJwk: await exportPublicKeyJwk(clientKeyPair.publicKey) });
        expect(clientRes.status).toBe(201);
        expect(clientRes.body.status).toBe('ACTIVE');

        const driverRes = await request(app)
            .post('/api/custody/signing-key/register')
            .set('Authorization', `Bearer ${driverToken}`)
            .send({ algorithm: 'ECDSA_P256_SHA256', publicKeyJwk: await exportPublicKeyJwk(driverKeyPair.publicKey) });
        expect(driverRes.status).toBe(201);
        expect(driverRes.body.status).toBe('ACTIVE');
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
        handshakeChallengeId = res.body.custodyChallenge.id;
    });

    it('POST /api/custody/challenges/:id/sign registra la firma del conductor para el handshake', async () => {
        const challengeRes = await request(app)
            .get(`/api/custody/challenges/${handshakeChallengeId}`)
            .set('Authorization', `Bearer ${driverToken}`);
        expect(challengeRes.status).toBe(200);

        const signature = await signMessage(driverKeyPair.privateKey, challengeRes.body.canonicalMessage);
        const res = await request(app)
            .post(`/api/custody/challenges/${handshakeChallengeId}/sign`)
            .set('Authorization', `Bearer ${driverToken}`)
            .send({ signature });

        expect(res.status).toBe(200);
        expect(res.body.signatures.some((entry: any) => entry.actorId === 2)).toBe(true);
    });

    // ── 5b. Confirmar conductor (CLIENT) ───────────────────────────────────

    it('POST /api/requests/:id/confirm-driver confirma conductor y avanza a IN_PROGRESS', async () => {
        const challengeRes = await request(app)
            .get(`/api/custody/challenges/${handshakeChallengeId}`)
            .set('Authorization', `Bearer ${clientToken}`);
        const clientSignature = await signMessage(clientKeyPair.privateKey, challengeRes.body.canonicalMessage);
        const signRes = await request(app)
            .post(`/api/custody/challenges/${handshakeChallengeId}/sign`)
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ signature: clientSignature });
        expect(signRes.status).toBe(200);

        const res = await request(app)
            .post(`/api/requests/${requestId}/confirm-driver`)
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ handshakeCode, challengeId: handshakeChallengeId });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('IN_PROGRESS');
        expect(res.body.custodySummary.storageMode).toBe('PERMISSIONED_CUSTODY_LEDGER');
    });

    // ── 6. Depositar (DRIVER) ──────────────────────────────────────────────

    it('POST /api/requests/:id/deposit cambia estado a DEPOSITED y genera código', async () => {
        const challengeRes = await request(app)
            .post('/api/custody/challenges')
            .set('Authorization', `Bearer ${driverToken}`)
            .send({ requestId, eventType: 'DEPOSITED' });
        const driverSignature = await signMessage(driverKeyPair.privateKey, challengeRes.body.canonicalMessage);
        const signRes = await request(app)
            .post(`/api/custody/challenges/${challengeRes.body.id}/sign`)
            .set('Authorization', `Bearer ${driverToken}`)
            .send({ signature: driverSignature });
        expect(signRes.status).toBe(200);

        const res = await request(app)
            .post(`/api/requests/${requestId}/deposit`)
            .set('Authorization', `Bearer ${driverToken}`)
            .send({ challengeId: challengeRes.body.id });

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
        const challengeRes = await request(app)
            .post('/api/custody/challenges')
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ requestId, eventType: 'PICKED_UP' });
        const clientSignature = await signMessage(clientKeyPair.privateKey, challengeRes.body.canonicalMessage);
        const signRes = await request(app)
            .post(`/api/custody/challenges/${challengeRes.body.id}/sign`)
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ signature: clientSignature });
        expect(signRes.status).toBe(200);

        const res = await request(app)
            .post('/api/lockers/open')
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ lockerCode, challengeId: challengeRes.body.id });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('PICKED_UP');
        expect(res.body.custodySummary.ledgerHeight).toBe(3);
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
