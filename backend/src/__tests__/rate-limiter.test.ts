/**
 * Hito 6.3.4 — Tests de rate limiting.
 *
 * Los limiters del módulo principal usan skipInTest=true en NODE_ENV=test
 * para que el resto de tests no se vean afectados. Aquí re-creamos
 * instancias con la MISMA configuración pero sin skip, para validar el
 * comportamiento real bajo carga.
 */
import express from 'express';
import request from 'supertest';
import rateLimit from 'express-rate-limit';

function appWithLimiter(max: number, windowMs = 60_000) {
    const a = express();
    a.use(
        rateLimit({
            windowMs,
            max,
            standardHeaders: true,
            legacyHeaders: false,
            message: { error: { code: 'TOO_MANY_REQUESTS' } },
        })
    );
    a.get('/probe', (_req, res) => res.json({ ok: true }));
    return a;
}

async function hitProbe(app: express.Express) {
    return request(app)
        .get('/probe')
        .set('X-Forwarded-For', '203.0.113.10');
}

describe('Hito 6.3.4 — Rate limiting (límites reales sin skipInTest)', () => {
    describe('authLimiter (10 req/min en producción)', () => {
        it('permite 10 peticiones consecutivas y bloquea la 11ª con 429', async () => {
            const a = appWithLimiter(10);
            const statuses: number[] = [];
            for (let i = 0; i < 11; i++) {
                const r = await hitProbe(a);
                statuses.push(r.status);
            }
            expect(statuses.filter(s => s === 200).length).toBe(10);
            expect(statuses.filter(s => s === 429).length).toBe(1);
        });

        it('429 incluye header Retry-After o RateLimit-Reset', async () => {
            const a = appWithLimiter(10);
            for (let i = 0; i < 10; i++) await hitProbe(a);
            const r = await hitProbe(a);
            expect(r.status).toBe(429);
            const hasRetryHeader =
                r.headers['retry-after'] !== undefined ||
                r.headers['ratelimit-reset'] !== undefined;
            expect(hasRetryHeader).toBe(true);
        });
    });

    describe('lockerOpenLimiter (5 req/min en producción)', () => {
        it('permite 5 y bloquea la 6ª', async () => {
            const a = appWithLimiter(5);
            const statuses: number[] = [];
            for (let i = 0; i < 6; i++) {
                const r = await hitProbe(a);
                statuses.push(r.status);
            }
            expect(statuses.filter(s => s === 200).length).toBe(5);
            expect(statuses.filter(s => s === 429).length).toBe(1);
        });

        it('respuesta 429 contiene mensaje de error tipado', async () => {
            const a = appWithLimiter(2);
            await hitProbe(a);
            await hitProbe(a);
            const r = await hitProbe(a);
            expect(r.status).toBe(429);
            expect(r.body.error?.code).toBe('TOO_MANY_REQUESTS');
        });
    });

    describe('globalLimiter (100 req/min en producción)', () => {
        it('permite 100 y bloquea la 101ª', async () => {
            const a = appWithLimiter(100);
            const statuses: number[] = [];
            for (let i = 0; i < 101; i++) {
                const r = await hitProbe(a);
                statuses.push(r.status);
            }
            expect(statuses.filter(s => s === 200).length).toBe(100);
            expect(statuses.filter(s => s === 429).length).toBe(1);
        });
    });

    describe('comportamiento con NODE_ENV=test (módulo real)', () => {
        it('los limiters del módulo principal son no-op con skipInTest=true', async () => {
            // Importar el limiter REAL (no recreado) y verificar que NO bloquea
            const { authLimiter } = await import('../middleware/rateLimiter');
            const a = express();
            a.use(authLimiter);
            a.get('/probe', (_req, res) => res.json({ ok: true }));

            // Hacer >10 peticiones; ninguna debería ser 429 porque skipInTest activado
            for (let i = 0; i < 15; i++) {
                const r = await request(a).get('/probe');
                expect(r.status).toBe(200);
            }
        });
    });
});
