/**
 * Tests de Seguridad
 */
import request from 'supertest';
import {
    setupTestDb,
    teardownTestDb,
    createTestApp,
    getClientToken,
    getDriverToken,
} from './helpers';

jest.mock('../db/database', () => {
    const actual = jest.requireActual('../db/database');
    return { ...actual, initDB: jest.fn() };
});

jest.mock('../sockets/io', () => ({
    emitEvent: jest.fn(),
    initSockets: jest.fn(),
}));

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

describe('Seguridad: Autenticación', () => {
    it('GET protegido sin token → 401', async () => {
        const res = await request(app).get('/api/requests/mine');
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('GET protegido con token inválido → 401', async () => {
        const res = await request(app)
            .get('/api/requests/mine')
            .set('Authorization', 'Bearer token_falso_completamente_invalido');
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('GET protegido con Bearer mal formado → 401', async () => {
        const res = await request(app)
            .get('/api/requests/mine')
            .set('Authorization', 'NotBearer xyz');
        expect(res.status).toBe(401);
    });
});

describe('Seguridad: Autorización por Rol', () => {
    it('CLIENT intenta acceder a ruta de DRIVER → 403', async () => {
        const res = await request(app)
            .get('/api/requests/pending')
            .set('Authorization', `Bearer ${clientToken}`);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('DRIVER intenta acceder a ruta de CLIENT → 403', async () => {
        const res = await request(app)
            .get('/api/requests/mine')
            .set('Authorization', `Bearer ${driverToken}`);
        expect(res.status).toBe(403);
    });
});

describe('Seguridad: Validación de Entrada', () => {
    it('POST request sin body → 400', async () => {
        const res = await request(app)
            .post('/api/requests')
            .set('Authorization', `Bearer ${clientToken}`)
            .send({});
        expect(res.status).toBe(400);
    });

    it('POST accept con ID no numérico → 400', async () => {
        const res = await request(app)
            .post('/api/requests/abc/accept')
            .set('Authorization', `Bearer ${driverToken}`);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('BAD_REQUEST');
    });

    it('POST deposit con ID no numérico → 400', async () => {
        const res = await request(app)
            .post('/api/requests/drop-table/deposit')
            .set('Authorization', `Bearer ${driverToken}`)
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('BAD_REQUEST');
    });

    it('POST open locker sin código → 400', async () => {
        const res = await request(app)
            .post('/api/lockers/open')
            .set('Authorization', `Bearer ${clientToken}`)
            .send({});
        expect(res.status).toBe(400);
    });
});

describe('Seguridad: Cabeceras HTTP', () => {
    it('Respuesta incluye cabeceras de seguridad Helmet', async () => {
        const res = await request(app).get('/api/health');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBeDefined();
    });
});
