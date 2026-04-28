/**
 * Hito 5.3.2 — smoke test de /metrics
 */
import express from 'express';
import request from 'supertest';
import { httpMetricsMiddleware, metricsHandler, httpRequestsTotal, registry } from '../observability/metrics';

describe('Hito 5.3.2 — Prometheus /metrics', () => {
    let app: express.Express;

    beforeAll(() => {
        app = express();
        app.use(httpMetricsMiddleware);
        app.get('/ping', (_req, res) => res.json({ ok: true }));
        app.get('/metrics', metricsHandler);
    });

    afterAll(() => {
        registry.resetMetrics();
    });

    it('expone metrics en formato Prometheus exposition', async () => {
        const r = await request(app).get('/metrics');
        expect(r.status).toBe(200);
        expect(r.headers['content-type']).toMatch(/text\/plain/);
        // default Node metrics
        expect(r.text).toContain('city2cruise_process_cpu_seconds_total');
        // custom metrics
        expect(r.text).toContain('city2cruise_http_requests_total');
        expect(r.text).toContain('city2cruise_request_match_seconds');
    });

    it('cuenta peticiones HTTP por método/ruta/status', async () => {
        const before = await registry.getSingleMetric('city2cruise_http_requests_total')!.get();
        await request(app).get('/ping').expect(200);
        await request(app).get('/ping').expect(200);
        const after = await registry.getSingleMetric('city2cruise_http_requests_total')!.get();

        // Aumentó al menos en 2
        const sumValues = (m: { values: { value: number }[] }) =>
            m.values.reduce((acc, v) => acc + v.value, 0);
        expect(sumValues(after as { values: { value: number }[] }) - sumValues(before as { values: { value: number }[] })).toBeGreaterThanOrEqual(2);
    });

    it('counter business: requestsCreatedTotal expone label locker_id', async () => {
        const m = registry.getSingleMetric('city2cruise_requests_created_total');
        expect(m).toBeDefined();
        // Increment para verificar que las labels funcionan
        const counter = m as unknown as { inc: (labels: Record<string, string>) => void };
        counter.inc({ locker_id: 'L-001' });
        const out = await registry.metrics();
        expect(out).toContain('city2cruise_requests_created_total{locker_id="L-001"}');
    });
});
