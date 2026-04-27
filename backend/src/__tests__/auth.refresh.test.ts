/**
 * Tests de refresh tokens, rotación y revocación.
 */
import request from 'supertest';
import { setupTestDb, teardownTestDb, createTestApp, getTestPool } from './helpers';

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

const VALID_PASSWORD = 'TestPass1!';
const TEST_EMAIL = 'refresh-test@example.com';

let app: any;

function extractRefreshCookie(res: request.Response): string | undefined {
    const raw = res.headers['set-cookie'];
    const cookies: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const found = cookies.find((c: string) => c.startsWith('refresh_token='));
    if (!found) return undefined;
    return found.split(';')[0].replace('refresh_token=', '');
}

beforeAll(async () => {
    await setupTestDb();

    // Registrar usuario con contraseña fuerte para estos tests
    const pool = getTestPool();
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash(VALID_PASSWORD, 10);
    await pool.query(
        'INSERT INTO users (name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, NOW()) ON CONFLICT (email) DO NOTHING',
        ['Refresh User', TEST_EMAIL, hash, 'CLIENT']
    );

    app = createTestApp();
});

afterAll(async () => {
    await teardownTestDb();
});

describe('POST /api/auth/login — emite refresh token', () => {
    it('devuelve access token + cookie HttpOnly al hacer login', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: TEST_EMAIL, password: VALID_PASSWORD });

        expect(res.status).toBe(200);
        expect(res.body.token).toBeDefined();

        const raw = res.headers['set-cookie'];
        const cookies: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
        const refreshCookie = cookies.find((c: string) => c.includes('refresh_token='));
        expect(refreshCookie).toBeDefined();
        expect(refreshCookie).toContain('HttpOnly');
        expect(refreshCookie).toContain('Path=/api/auth');
    });
});

describe('POST /api/auth/refresh', () => {
    it('devuelve nuevo access token con refresh token válido', async () => {
        const loginRes = await request(app)
            .post('/api/auth/login')
            .send({ email: TEST_EMAIL, password: VALID_PASSWORD });

        const rawCookie = extractRefreshCookie(loginRes);
        expect(rawCookie).toBeDefined();

        const refreshRes = await request(app)
            .post('/api/auth/refresh')
            .set('Cookie', `refresh_token=${rawCookie}`);

        expect(refreshRes.status).toBe(200);
        expect(refreshRes.body.token).toBeDefined();
        expect(refreshRes.body.token).not.toBe(loginRes.body.token);
    });

    it('rota el refresh token (el viejo ya no sirve)', async () => {
        const loginRes = await request(app)
            .post('/api/auth/login')
            .send({ email: TEST_EMAIL, password: VALID_PASSWORD });

        const oldCookie = extractRefreshCookie(loginRes);

        // Primera rotación — válida
        await request(app)
            .post('/api/auth/refresh')
            .set('Cookie', `refresh_token=${oldCookie}`)
            .expect(200);

        // Segunda rotación con el token viejo — debe fallar
        const secondRes = await request(app)
            .post('/api/auth/refresh')
            .set('Cookie', `refresh_token=${oldCookie}`);

        expect(secondRes.status).toBe(401);
    });

    it('reutilizar token revocado invalida toda la familia', async () => {
        const loginRes = await request(app)
            .post('/api/auth/login')
            .send({ email: TEST_EMAIL, password: VALID_PASSWORD });

        const oldCookie = extractRefreshCookie(loginRes);

        // Rotar una vez para obtener el nuevo token
        const firstRefresh = await request(app)
            .post('/api/auth/refresh')
            .set('Cookie', `refresh_token=${oldCookie}`)
            .expect(200);

        const newCookie = extractRefreshCookie(firstRefresh);

        // Reutilizar el token viejo (ya revocado) → invalida la familia entera
        await request(app)
            .post('/api/auth/refresh')
            .set('Cookie', `refresh_token=${oldCookie}`)
            .expect(401);

        // El token nuevo de la misma familia también debe haber sido revocado
        const newCookieRes = await request(app)
            .post('/api/auth/refresh')
            .set('Cookie', `refresh_token=${newCookie}`);

        expect(newCookieRes.status).toBe(401);
    });

    it('rechaza petición sin cookie', async () => {
        const res = await request(app).post('/api/auth/refresh');
        expect(res.status).toBe(401);
    });
});

describe('POST /api/auth/logout', () => {
    it('revoca el refresh token y limpia la cookie', async () => {
        const loginRes = await request(app)
            .post('/api/auth/login')
            .send({ email: TEST_EMAIL, password: VALID_PASSWORD });

        const cookie = extractRefreshCookie(loginRes);

        await request(app)
            .post('/api/auth/logout')
            .set('Cookie', `refresh_token=${cookie}`)
            .expect(200);

        // Intentar refrescar con el token revocado debe fallar
        const refreshRes = await request(app)
            .post('/api/auth/refresh')
            .set('Cookie', `refresh_token=${cookie}`);

        expect(refreshRes.status).toBe(401);
    });
});
