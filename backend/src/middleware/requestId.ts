/**
 * Hito 5.3.5 — middleware que asigna un request_id a cada petición HTTP
 * y lo expone como `x-request-id` (echo del cliente o uno generado).
 * Pinta el log line de access con request_id, status y duración.
 */
import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            requestId: string;
        }
    }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    req.requestId = (incoming && incoming.length < 64) ? incoming : randomUUID();
    res.setHeader('x-request-id', req.requestId);

    const start = process.hrtime.bigint();
    res.on('finish', () => {
        const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
        logger.info({
            request_id: req.requestId,
            method: req.method,
            path: req.originalUrl?.split('?')[0],
            status: res.statusCode,
            duration_ms: Math.round(elapsedMs * 100) / 100,
            ip: req.ip,
        }, 'http_request');
    });

    next();
}
