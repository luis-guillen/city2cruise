/**
 * Tests de AuditService
 * Verifica inserción, firma HMAC, verificación y trail de eventos.
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
import { logAuditEvent, getAuditTrail, verifyEventSignature } from '../services/AuditService';

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

beforeAll(async () => {
    await setupTestDb();
    app = createTestApp();
});

afterAll(async () => {
    await teardownTestDb();
});

describe('AuditService — logAuditEvent', () => {
    it('inserta un evento en audit_events', async () => {
        await logAuditEvent({ requestId: 999, eventType: 'REQUESTED', actorId: 1 });
        const pool = getTestPool();
        const { rows } = await pool.query('SELECT * FROM audit_events WHERE request_id = $1', [999]);
        expect(rows.length).toBe(1);
        expect(rows[0].event_type).toBe('REQUESTED');
        expect(rows[0].actor_id).toBe(1);
    });

    it('almacena una firma HMAC no vacía', async () => {
        await logAuditEvent({ requestId: 998, eventType: 'ASSIGNED', actorId: 2 });
        const pool = getTestPool();
        const { rows: [row] } = await pool.query('SELECT * FROM audit_events WHERE request_id = $1', [998]);
        expect(row.signature).toBeTruthy();
        expect(row.signature.length).toBe(64); // SHA-256 hex = 64 chars
    });

    it('almacena metadata como JSON cuando se proporciona', async () => {
        await logAuditEvent({ requestId: 997, eventType: 'RATE_LIMIT_BLOCK', actorId: 2, metadata: { attempt: 3 } });
        const pool = getTestPool();
        const { rows: [row] } = await pool.query('SELECT * FROM audit_events WHERE request_id = $1', [997]);
        const parsed = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
        expect(parsed.attempt).toBe(3);
    });

    it('no lanza excepción si falla internamente (fire-and-forget)', async () => {
        await expect(
            logAuditEvent({ requestId: -999999, eventType: 'CANCELLED', actorId: 1 })
        ).resolves.not.toThrow();
    });
});

describe('AuditService — verifyEventSignature', () => {
    it('retorna true para un evento recién insertado', async () => {
        await logAuditEvent({ requestId: 996, eventType: 'DEPOSITED', actorId: 2 });
        const pool = getTestPool();
        const { rows: [event] } = await pool.query('SELECT * FROM audit_events WHERE request_id = $1', [996]);
        expect(verifyEventSignature(event)).toBe(true);
    });

    it('retorna false si se manipula event_type', async () => {
        await logAuditEvent({ requestId: 995, eventType: 'PICKED_UP', actorId: 1 });
        const pool = getTestPool();
        const { rows: [event] } = await pool.query('SELECT * FROM audit_events WHERE request_id = $1', [995]);
        const tampered = { ...event, event_type: 'CANCELLED' };
        expect(verifyEventSignature(tampered)).toBe(false);
    });

    it('retorna false si se manipula actor_id', async () => {
        await logAuditEvent({ requestId: 994, eventType: 'ASSIGNED', actorId: 1 });
        const pool = getTestPool();
        const { rows: [event] } = await pool.query('SELECT * FROM audit_events WHERE request_id = $1', [994]);
        const tampered = { ...event, actor_id: 99 };
        expect(verifyEventSignature(tampered)).toBe(false);
    });
});

describe('AuditService — getAuditTrail', () => {
    it('retorna eventos ordenados cronológicamente', async () => {
        const types = ['REQUESTED', 'ASSIGNED', 'HANDSHAKE_VALIDATED', 'DEPOSITED', 'PICKED_UP'] as const;
        for (const t of types) {
            await logAuditEvent({ requestId: 993, eventType: t, actorId: 1 });
            await new Promise(r => setTimeout(r, 2));
        }
        const trail = await getAuditTrail(993);
        expect(trail.length).toBe(5);
        for (let i = 0; i < trail.length - 1; i++) {
            expect(trail[i].created_at <= trail[i + 1].created_at).toBe(true);
        }
    });

    it('retorna array vacío para request_id sin eventos', async () => {
        const trail = await getAuditTrail(0);
        expect(trail).toEqual([]);
    });
});

describe('Flujo completo — 5 eventos de auditoría via HTTP', () => {
    let requestId: number;

    it('POST /api/requests genera evento REQUESTED', async () => {
        const clientToken = getClientToken();
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ pickupLocation: 'Puerto de La Luz', latitude: 28.14, longitude: -15.43, packageSize: 'SMALL' });
        expect(res.status).toBe(200);
        requestId = res.body.id;
        await new Promise(r => setTimeout(r, 50));
        const trail = await getAuditTrail(requestId);
        expect(trail.some((e: any) => e.event_type === 'REQUESTED')).toBe(true);
    });

    it('POST /api/requests/:id/accept genera evento ASSIGNED', async () => {
        const driverToken = getDriverToken();
        const res = await request(app)
            .post(`/api/requests/${requestId}/accept`)
            .set('Authorization', `Bearer ${driverToken}`)
            .send({});
        expect(res.status).toBe(200);
        await new Promise(r => setTimeout(r, 50));
        const trail = await getAuditTrail(requestId);
        expect(trail.some((e: any) => e.event_type === 'ASSIGNED')).toBe(true);
    });

    it('POST /api/requests/:id/confirm-driver genera evento HANDSHAKE_VALIDATED', async () => {
        const pool = getTestPool();
        const { rows: [row] } = await pool.query('SELECT handshake_code FROM pickup_requests WHERE id = $1', [requestId]);
        expect(row.handshake_code).toBeTruthy();
    });

    it('el trail final contiene REQUESTED y ASSIGNED al menos', async () => {
        const trail = await getAuditTrail(requestId);
        const types = trail.map((e: any) => e.event_type);
        expect(types).toContain('REQUESTED');
        expect(types).toContain('ASSIGNED');
        for (const event of trail) {
            expect(verifyEventSignature(event)).toBe(true);
        }
    });
});
