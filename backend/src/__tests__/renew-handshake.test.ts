import request from 'supertest';
import {
    setupTestDb,
    teardownTestDb,
    createTestApp,
    getClientToken,
    getDriverToken,
    getTestPool,
} from './helpers';

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
import bcrypt from 'bcrypt';
import { getAuditTrail } from '../services/AuditService';

jest.mock('../sockets/io', () => ({
    emitEvent: jest.fn(),
    emitToUser: jest.fn(),
    emitToSocket: jest.fn(),
    initSockets: jest.fn(),
    getActiveDrivers: jest.fn(() => []),
}));

jest.mock('../db/database', () => {
    const actual = jest.requireActual('../db/database');
    return { ...actual, initDB: jest.fn() };
});

describe('Renew Handshake', () => {
    let app: any;
    let clientToken: string;
    let driverToken: string;
    let requestId: number;
    let originalHandshakeCode: string;

    beforeAll(async () => {
        await setupTestDb();
        app = createTestApp();
        clientToken = getClientToken();
        driverToken = getDriverToken();
    });

    afterAll(async () => {
        await teardownTestDb();
    });

    it('Setup: crea request y la acepta', async () => {
        const createRes = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ pickupLocation: 'Test Location', packageSize: 'SMALL' });

        expect(createRes.status).toBe(200);
        requestId = createRes.body.id;

        const acceptRes = await request(app)
            .post(`/api/requests/${requestId}/accept`)
            .set('Authorization', `Bearer ${driverToken}`);

        expect(acceptRes.status).toBe(200);
        expect(acceptRes.body.status).toBe('CONFIRMATION_PENDING');
        originalHandshakeCode = acceptRes.body.handshakeCode;
        
        expect(originalHandshakeCode).toBeDefined();
    });

    it('debería generar nuevo código de 4 dígitos y nueva expiración', async () => {
        const pool = getTestPool();
        const { rows: [beforeData] } = await pool.query(
            'SELECT handshake_expires_at, handshake_code FROM pickup_requests WHERE id = $1', [requestId]
        );
        
        await delay(100);

        const res = await request(app)
            .post(`/api/requests/${requestId}/renew-handshake`)
            .set('Authorization', `Bearer ${driverToken}`);

        expect(res.status).toBe(200);
        const { handshakeCode } = res.body;

        expect(handshakeCode).toBeDefined();
        expect(handshakeCode).not.toBe(originalHandshakeCode);
        expect(handshakeCode.length).toBe(4);

        const { rows: [afterData] } = await pool.query(
            'SELECT handshake_expires_at, handshake_code FROM pickup_requests WHERE id = $1', [requestId]
        );
        expect(afterData.handshake_expires_at).not.toBe(beforeData.handshake_expires_at);
        
        const isMatch = await bcrypt.compare(handshakeCode, afterData.handshake_code);
        expect(isMatch).toBe(true);
    });

    it('debería retornar el nuevo código en la respuesta', async () => {
        const res = await request(app)
            .post(`/api/requests/${requestId}/renew-handshake`)
            .set('Authorization', `Bearer ${driverToken}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('handshakeCode');
        expect(res.body.handshakeCode.length).toBe(4);
    });

    it('debería crear audit event HANDSHAKE_RENEWED', async () => {
        const trail = await getAuditTrail(requestId);
        
        const renewEvents = trail.filter((e: any) => e.event_type === 'HANDSHAKE_RENEWED');
        expect(renewEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('debería rechazar renovación si request no está en estado accepted (CONFIRMATION_PENDING)', async () => {
        const pool = getTestPool();

        const req2res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ pickupLocation: 'Pending', packageSize: 'SMALL' });
            
        const req2Id = req2res.body.id;

        // Intentar renovar en REQUESTED
        const failRes = await request(app)
            .post(`/api/requests/${req2Id}/renew-handshake`)
            .set('Authorization', `Bearer ${driverToken}`);

        expect(failRes.status).toBe(403);
        expect(failRes.body.error.code).toBe('FORBIDDEN');

        // Avanzar el original a IN_PROGRESS para probar error post-confirmación
        await pool.query("UPDATE pickup_requests SET status = 'IN_PROGRESS' WHERE id = $1", [requestId]);

        const failRes2 = await request(app)
            .post(`/api/requests/${requestId}/renew-handshake`)
            .set('Authorization', `Bearer ${driverToken}`);

        expect(failRes2.status).toBe(409);
        expect(failRes2.body.error.code).toBe('CONFLICT');
    });

    it('debería rechazar renovación si es el driver incorrecto', async () => {
        const pool = getTestPool();

        const { rows: [anotherDriver] } = await pool.query(
            `INSERT INTO users (name, email, password_hash, role, created_at) 
             VALUES ('Ot', 'other@o.com', 'pwd', 'DRIVER', $1) RETURNING id`,
            [new Date().toISOString()]
        );
        
        const jwt = require('jsonwebtoken');
        const newToken = jwt.sign({ id: anotherDriver.id, name: 'Ot', role: 'DRIVER', status: 'approved' }, process.env.JWT_SECRET || 'secret123');

        // Volvemos req2 a CONFIRMATION_PENDING asignado al driver original (id 2)
        const { rows: [req2] } = await pool.query(
            "SELECT id FROM pickup_requests WHERE pickup_location = 'Pending'"
        );
        const localReq2Id = req2.id;
        await pool.query(
            "UPDATE pickup_requests SET status = 'CONFIRMATION_PENDING', driver_id = 2 WHERE id = $1",
            [localReq2Id]
        );
        
        const res = await request(app)
            .post(`/api/requests/${localReq2Id}/renew-handshake`)
            .set('Authorization', `Bearer ${newToken}`);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('debería retornar 404 si la request no existe', async () => {
        const res = await request(app)
            .post(`/api/requests/9999/renew-handshake`)
            .set('Authorization', `Bearer ${driverToken}`);

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
    });
});
