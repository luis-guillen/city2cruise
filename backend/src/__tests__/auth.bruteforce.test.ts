/**
 * Tests de protección brute-force en login y política de contraseñas.
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

let app: any;

beforeAll(async () => {
    await setupTestDb();
    app = createTestApp();
});

afterAll(async () => {
    await teardownTestDb();
});

// Limpia login_attempts entre tests para no contaminar
afterEach(async () => {
    await getTestPool().query('TRUNCATE TABLE login_attempts CASCADE');
});

describe('Login brute-force protection', () => {
    const ip = '10.0.0.1';

    async function failLogin(times: number) {
        for (let i = 0; i < times; i++) {
            await request(app)
                .post('/api/auth/login')
                .set('X-Forwarded-For', ip)
                .send({ email: 'client@test.com', password: 'wrong_password' });
        }
    }

    it('permite hasta 4 intentos fallidos sin bloquear', async () => {
        await failLogin(4);

        const res = await request(app)
            .post('/api/auth/login')
            .set('X-Forwarded-For', ip)
            .send({ email: 'client@test.com', password: 'wrong_password' });

        // 5º intento: aún no bloqueado (aún no ha superado el umbral de 5)
        expect(res.status).toBe(401);
    });

    it('bloquea la IP tras el 5º intento fallido con 429 y Retry-After', async () => {
        await failLogin(5);

        const res = await request(app)
            .post('/api/auth/login')
            .set('X-Forwarded-For', ip)
            .send({ email: 'client@test.com', password: 'wrong_password' });

        expect(res.status).toBe(429);
        expect(res.headers['retry-after']).toBeDefined();
        expect(res.body.error.code).toBe('TOO_MANY_LOGIN_ATTEMPTS');
        expect(res.body.error.retryAfter).toBeGreaterThan(0);
    });

    it('bloquea incluso un login correcto cuando la IP está bloqueada', async () => {
        await failLogin(5);

        const res = await request(app)
            .post('/api/auth/login')
            .set('X-Forwarded-For', ip)
            .send({ email: 'client@test.com', password: 'password123' });

        expect(res.status).toBe(429);
    });

    it('IPs distintas son independientes', async () => {
        await failLogin(5);  // bloquea 10.0.0.1

        const res = await request(app)
            .post('/api/auth/login')
            .set('X-Forwarded-For', '10.0.0.2')
            .send({ email: 'client@test.com', password: 'wrong_password' });

        // IP distinta no está bloqueada
        expect(res.status).toBe(401);
    });
});

describe('Política de contraseñas en registro', () => {
    it('rechaza contraseña con menos de 8 caracteres', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ name: 'Test', email: 'pw-test1@example.com', password: 'Ab1!', role: 'CLIENT' });

        expect(res.status).toBe(400);
        expect(res.body.error.message).toMatch(/8/);
    });

    it('rechaza contraseña sin mayúsculas', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ name: 'Test', email: 'pw-test2@example.com', password: 'testpass1!', role: 'CLIENT' });

        expect(res.status).toBe(400);
        expect(res.body.error.message).toMatch(/mayúscula/i);
    });

    it('rechaza contraseña sin minúsculas', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ name: 'Test', email: 'pw-test3@example.com', password: 'TESTPASS1!', role: 'CLIENT' });

        expect(res.status).toBe(400);
        expect(res.body.error.message).toMatch(/minúscula/i);
    });

    it('rechaza contraseña sin número', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ name: 'Test', email: 'pw-test4@example.com', password: 'TestPass!!', role: 'CLIENT' });

        expect(res.status).toBe(400);
        expect(res.body.error.message).toMatch(/número/i);
    });

    it('rechaza contraseña sin carácter especial', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ name: 'Test', email: 'pw-test5@example.com', password: 'TestPass1', role: 'CLIENT' });

        expect(res.status).toBe(400);
        expect(res.body.error.message).toMatch(/especial/i);
    });

    it('rechaza contraseñas comunes', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ name: 'Test', email: 'pw-test6@example.com', password: 'password', role: 'CLIENT' });

        expect(res.status).toBe(400);
    });

    it('acepta contraseña fuerte y crea usuario', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ name: 'Test', email: 'pw-strong@example.com', password: 'SecurePass1!', role: 'CLIENT' });

        expect(res.status).toBe(201);
        expect(res.body.token).toBeDefined();
    });
});

describe('validatePassword (unit)', () => {
    const { validatePassword } = require('../auth/passwordPolicy');

    it('pasa una contraseña fuerte', () => {
        const result = validatePassword('SecurePass1!');
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('recoge múltiples errores a la vez', () => {
        const result = validatePassword('abc');
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(1);
    });
});
