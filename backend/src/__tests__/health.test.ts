/**
 * Hito 5.3.6 — smoke test del endpoint /health (sin DB).
 * /ready se prueba en integración con DB y Redis.
 */
import express from 'express';
import request from 'supertest';
import { healthRouter } from '../routes/health';

describe('Hito 5.3.6 — /health (liveness)', () => {
    let app: express.Express;

    beforeAll(() => {
        app = express();
        app.use(healthRouter);
    });

    it('responde 200 con status ok y campos esperados', async () => {
        const r = await request(app).get('/health');
        expect(r.status).toBe(200);
        expect(r.body.status).toBe('ok');
        expect(r.body.uptime_seconds).toBeGreaterThanOrEqual(0);
        expect(r.body.env).toBeDefined();
        expect(typeof r.body.timestamp).toBe('string');
        expect(new Date(r.body.timestamp).toString()).not.toBe('Invalid Date');
    });

    it('liveness no requiere DB ni Redis (responde aunque caigan)', async () => {
        // Si lo anterior pasa, este test es trivial — confirma que /health
        // no llama a db ni redis.
        const r = await request(app).get('/health');
        expect(r.status).toBe(200);
    });
});
