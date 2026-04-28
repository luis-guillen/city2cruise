/**
 * Hito 5.3.2 — Prometheus métricas técnicas.
 *
 * Expone:
 *   - default Node.js metrics (event loop, GC, RSS, heap)
 *   - http_requests_total{method,route,status}
 *   - http_request_duration_seconds{method,route,status} (histogram, p50/p95/p99)
 *   - active_websocket_connections{namespace}
 *   - db_query_duration_seconds{op}
 *   - business_* (poblados desde Hito 5.3.3)
 *
 * Endpoint: GET /metrics  (sin autenticación, expuesto sólo intra-VPC en prod)
 */
import client from 'prom-client';
import type { Request, Response, NextFunction } from 'express';

export const registry = new client.Registry();

// Default metrics: event loop lag, GC, heap, RSS, file descriptors...
client.collectDefaultMetrics({
    register: registry,
    prefix: 'city2cruise_',
    gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
});

// ─── HTTP ──────────────────────────────────────────────────────────────────
export const httpRequestsTotal = new client.Counter({
    name: 'city2cruise_http_requests_total',
    help: 'Total de peticiones HTTP recibidas',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [registry],
});

export const httpRequestDuration = new client.Histogram({
    name: 'city2cruise_http_request_duration_seconds',
    help: 'Duración de peticiones HTTP en segundos',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
});

// ─── WebSockets ───────────────────────────────────────────────────────────
export const wsConnections = new client.Gauge({
    name: 'city2cruise_websocket_connections',
    help: 'Conexiones WebSocket activas',
    labelNames: ['namespace'] as const,
    registers: [registry],
});

// ─── DB ───────────────────────────────────────────────────────────────────
export const dbQueryDuration = new client.Histogram({
    name: 'city2cruise_db_query_duration_seconds',
    help: 'Duración de queries Postgres en segundos',
    labelNames: ['op'] as const, // SELECT/INSERT/UPDATE/DELETE/OTHER
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
    registers: [registry],
});

// ─── Business (Hito 5.3.3) ────────────────────────────────────────────────
export const requestsCreatedTotal = new client.Counter({
    name: 'city2cruise_requests_created_total',
    help: 'Pickup requests creadas (todos los estados)',
    labelNames: ['locker_id'] as const,
    registers: [registry],
});

export const requestsCompletedTotal = new client.Counter({
    name: 'city2cruise_requests_completed_total',
    help: 'Pickup requests completadas con éxito',
    registers: [registry],
});

export const requestsFailedTotal = new client.Counter({
    name: 'city2cruise_requests_failed_total',
    help: 'Pickup requests que fallaron (no_driver, timeout, cancel, etc.)',
    labelNames: ['reason'] as const,
    registers: [registry],
});

export const driversOnline = new client.Gauge({
    name: 'city2cruise_drivers_online',
    help: 'Drivers conectados y disponibles',
    registers: [registry],
});

export const requestMatchSeconds = new client.Histogram({
    name: 'city2cruise_request_match_seconds',
    help: 'Tiempo desde que se crea un request hasta que un driver lo acepta',
    buckets: [1, 5, 10, 30, 60, 120, 300, 600],
    registers: [registry],
});

// ─── Express middleware ───────────────────────────────────────────────────
/**
 * Middleware HTTP: cuenta peticiones y mide latencia.
 * Se aplica DESPUÉS del router para que `req.route.path` esté poblado.
 */
export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
        const route = (req.route?.path as string | undefined)
            ?? req.baseUrl
            ?? 'unknown';

        // Normalizar — meter todo en /api/X para no explosionar cardinalidad
        const normalized = route.length > 80 ? 'too_long' : route;

        const labels = {
            method: req.method,
            route: normalized,
            status: String(res.statusCode),
        };

        httpRequestsTotal.inc(labels);

        const elapsedNs = Number(process.hrtime.bigint() - start);
        httpRequestDuration.observe(labels, elapsedNs / 1e9);
    });

    next();
}

/**
 * Handler GET /metrics — formato exposition de Prometheus.
 */
export async function metricsHandler(_req: Request, res: Response): Promise<void> {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
}
