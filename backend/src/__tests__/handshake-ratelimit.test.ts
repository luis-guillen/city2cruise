/**
 * Tests de Rate Limiting del Handshake
 */
import request from 'supertest';
import {
    setupTestDb,
    teardownTestDb,
    createTestApp,
    getClientToken,
    getDriverToken,
    getTestPool,
} from './helpers';

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
let clientToken: string;
let driverToken: string;
let requestId: number;
let validCode: string;

beforeAll(async () => {
    await setupTestDb();
    app = createTestApp();
    clientToken = getClientToken();
    driverToken = getDriverToken();

    const createRes = await request(app)
        .post('/api/requests')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ pickupLocation: 'Test Location', latitude: 28.14, longitude: -15.43, packageSize: 'SMALL' });
    requestId = createRes.body.id;

    const acceptRes = await request(app)
        .post(`/api/requests/${requestId}/accept`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({});
    validCode = acceptRes.body.handshakeCode;
});

afterAll(async () => {
    await teardownTestDb();
});

describe('Handshake Rate Limiting', () => {
    it('primer intento fallido devuelve 400 y se registra en handshake_attempts', async () => {
        const res = await request(app)
            .post(`/api/requests/${requestId}/confirm-driver`)
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ handshakeCode: '0000' });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_CODE');

        const pool = getTestPool();
        const { rows: attempts } = await pool.query(
            "SELECT * FROM handshake_attempts WHERE request_id = $1 AND result = 'failure'",
            [requestId]
        );
        expect(attempts.length).toBe(1);
        expect(attempts[0].failure_reason).toBe('PIN_MISMATCH');
    });

    it('segundo intento fallido se registra correctamente', async () => {
        const res = await request(app)
            .post(`/api/requests/${requestId}/confirm-driver`)
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ handshakeCode: '1111' });
        expect(res.status).toBe(400);

        const pool = getTestPool();
        const { rows: attempts } = await pool.query(
            "SELECT * FROM handshake_attempts WHERE request_id = $1 AND result = 'failure'",
            [requestId]
        );
        expect(attempts.length).toBe(2);
    });

    it('tercer intento fallido se registra y alcanza el límite', async () => {
        const res = await request(app)
            .post(`/api/requests/${requestId}/confirm-driver`)
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ handshakeCode: '2222' });
        expect(res.status).toBe(400);

        const pool = getTestPool();
        const { rows: attempts } = await pool.query(
            "SELECT * FROM handshake_attempts WHERE request_id = $1 AND result = 'failure'",
            [requestId]
        );
        expect(attempts.length).toBe(3);

        await new Promise(r => setTimeout(r, 50));
        const { rows: [auditBlock] } = await pool.query(
            "SELECT * FROM audit_events WHERE request_id = $1 AND event_type = 'RATE_LIMIT_BLOCK'",
            [requestId]
        );
        expect(auditBlock).toBeTruthy();
    });

    it('cuarto intento es rechazado con 423 Locked', async () => {
        const res = await request(app)
            .post(`/api/requests/${requestId}/confirm-driver`)
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ handshakeCode: '3333' });
        expect(res.status).toBe(423);
        expect(res.body.error.code).toBe('RATE_LIMIT_PIN_EXCEEDED');
    });

    it('quinto intento también es rechazado con 423 (sigue bloqueado)', async () => {
        const res = await request(app)
            .post(`/api/requests/${requestId}/confirm-driver`)
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ handshakeCode: validCode });
        expect(res.status).toBe(423);
    });
});

describe('Handshake Rate Limiting — intento exitoso antes del límite', () => {
    let reqId2: number;

    beforeAll(async () => {
        const createRes = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ pickupLocation: 'Test Location 2', latitude: 28.14, longitude: -15.43, packageSize: 'SMALL' });
        reqId2 = createRes.body.id;

        await request(app)
            .post(`/api/requests/${reqId2}/accept`)
            .set('Authorization', `Bearer ${driverToken}`)
            .send({});
    });

    it('un intento fallido seguido de uno exitoso completa el handshake', async () => {
        const fail = await request(app)
            .post(`/api/requests/${reqId2}/confirm-driver`)
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ handshakeCode: '0000' });
        expect(fail.status).toBe(400);

        const pool = getTestPool();
        const { rows: [row] } = await pool.query('SELECT status FROM pickup_requests WHERE id = $1', [reqId2]);
        expect(row.status).toBe('CONFIRMATION_PENDING');
    });

    it('después del éxito, el pedido pasa a IN_PROGRESS y no acepta más códigos', async () => {
        const createRes = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ pickupLocation: 'Test Location 3', latitude: 28.14, longitude: -15.43, packageSize: 'SMALL' });
        const reqId3 = createRes.body.id;

        const acceptRes = await request(app)
            .post(`/api/requests/${reqId3}/accept`)
            .set('Authorization', `Bearer ${driverToken}`)
            .send({});
        const plainCode = acceptRes.body.handshakeCode;
        expect(plainCode).toBeTruthy();

        const confirm = await request(app)
            .post(`/api/requests/${reqId3}/confirm-driver`)
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ handshakeCode: plainCode });
        expect(confirm.status).toBe(200);

        const pool = getTestPool();
        const { rows: [row] } = await pool.query('SELECT status FROM pickup_requests WHERE id = $1', [reqId3]);
        expect(row.status).toBe('IN_PROGRESS');

        const again = await request(app)
            .post(`/api/requests/${reqId3}/confirm-driver`)
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ handshakeCode: plainCode });
        expect(again.status).toBe(409);
    });
});
