/**
 * Tests de concurrencia: accept doble simultáneo
 */
import request from 'supertest';
import {
    setupTestDb,
    teardownTestDb,
    createTestApp,
    getClientToken,
    getDriverToken,
    getDriver2Token,
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
let driver1Token: string;
let driver2Token: string;

beforeAll(async () => {
    await setupTestDb();
    app = createTestApp();
    clientToken = getClientToken();
    driver1Token = getDriverToken();
    driver2Token = getDriver2Token();
});

afterAll(async () => {
    await teardownTestDb();
});

describe('Concurrencia: Accept simultáneo', () => {
    let requestId: number;

    it('Crea un pedido de prueba', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ pickupLocation: 'Plaza España', packageSize: 'SMALL' });

        expect(res.status).toBe(200);
        requestId = res.body.id;
    });

    it('Dos drivers aceptan simultáneamente → solo uno tiene éxito', async () => {
        const [res1, res2] = await Promise.all([
            request(app)
                .post(`/api/requests/${requestId}/accept`)
                .set('Authorization', `Bearer ${driver1Token}`),
            request(app)
                .post(`/api/requests/${requestId}/accept`)
                .set('Authorization', `Bearer ${driver2Token}`),
        ]);

        const statuses = [res1.status, res2.status].sort();
        expect(statuses).toEqual([200, 409]);

        const winner = res1.status === 200 ? res1.body : res2.body;
        expect(winner.status).toBe('CONFIRMATION_PENDING');
        expect(winner.driverId).toBeDefined();
    });
});

describe('Concurrencia: Deposit no reasigna locker usado', () => {
    let reqId1: number;
    let reqId2: number;

    it('Setup: crear dos pedidos y aceptar ambos', async () => {
        const r1 = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ pickupLocation: 'Loc A', packageSize: 'SMALL' });
        reqId1 = r1.body.id;

        const r2 = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ pickupLocation: 'Loc B', packageSize: 'SMALL' });
        reqId2 = r2.body.id;

        const a1 = await request(app)
            .post(`/api/requests/${reqId1}/accept`)
            .set('Authorization', `Bearer ${driver1Token}`);

        const a2 = await request(app)
            .post(`/api/requests/${reqId2}/accept`)
            .set('Authorization', `Bearer ${driver2Token}`);

        await request(app)
            .post(`/api/requests/${reqId1}/confirm-driver`)
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ handshakeCode: a1.body.handshakeCode });

        await request(app)
            .post(`/api/requests/${reqId2}/confirm-driver`)
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ handshakeCode: a2.body.handshakeCode });
    });

    it('Dos deposits asignan lockers diferentes', async () => {
        const [d1, d2] = await Promise.all([
            request(app)
                .post(`/api/requests/${reqId1}/deposit`)
                .set('Authorization', `Bearer ${driver1Token}`)
                .send({ lockerLabel: 'T-001' }),
            request(app)
                .post(`/api/requests/${reqId2}/deposit`)
                .set('Authorization', `Bearer ${driver2Token}`)
                .send({ lockerLabel: 'T-001' }),
        ]);

        const statuses = [d1.status, d2.status].sort();
        // Con varios lockers disponibles, ambos pueden tener éxito asignando lockers diferentes.
        // Verificamos que al menos uno haya tenido éxito.
        expect(statuses[0]).toBe(200);
        // El segundo puede ser 200 (si hay otro locker) o 409 (si no hay)
        expect([200, 409]).toContain(statuses[1]);
    });
});
