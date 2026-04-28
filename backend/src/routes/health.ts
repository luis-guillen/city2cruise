/**
 * Hito 5.3.6 — Health checks separados.
 *
 * /health  — Liveness: ¿está el proceso vivo? Sin checks externos.
 *            Usado por: ALB target group, Fly health check, k8s liveness.
 * /ready   — Readiness: ¿puede atender tráfico real? Verifica DB + Redis.
 *            Usado por: k8s readiness, monitoring externo (uptimerobot/Better Stack).
 *
 * Ambos en root (no /api) para que no compitan con rate-limiter ni autenticación.
 */
import type { Request, Response } from 'express';
import { Router } from 'express';
import { db } from '../db/database';
import { cacheGet, cacheSet } from '../cache/cache';

export const healthRouter = Router();

const startedAt = Date.now();

healthRouter.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
        status: 'ok',
        uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
        version: process.env.npm_package_version || 'dev',
        env: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
    });
});

healthRouter.get('/ready', async (_req: Request, res: Response) => {
    const checks: Record<string, { ok: boolean; latency_ms?: number; error?: string }> = {};

    // Check Postgres
    const dbStart = Date.now();
    try {
        await db.query('SELECT 1');
        checks.database = { ok: true, latency_ms: Date.now() - dbStart };
    } catch (err) {
        checks.database = { ok: false, latency_ms: Date.now() - dbStart, error: (err as Error).message };
    }

    // Check Redis (round trip set/get)
    const redisStart = Date.now();
    try {
        await cacheSet('healthcheck:ping', 'pong', 5);
        const value = await cacheGet('healthcheck:ping');
        checks.redis = {
            ok: value === 'pong',
            latency_ms: Date.now() - redisStart,
            ...(value !== 'pong' ? { error: 'unexpected value' } : {}),
        };
    } catch (err) {
        checks.redis = { ok: false, latency_ms: Date.now() - redisStart, error: (err as Error).message };
    }

    const allOk = Object.values(checks).every(c => c.ok);
    const status = allOk ? 200 : 503;

    res.status(status).json({
        status: allOk ? 'ready' : 'not_ready',
        uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
        timestamp: new Date().toISOString(),
        checks,
    });
});
