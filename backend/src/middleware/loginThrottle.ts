import { Request, Response, NextFunction } from 'express';
import { db } from '../db/database';
import { config } from '../config/env';
import { logger } from '../utils/logger';

interface BackoffWindow {
    minFailures: number;
    windowSeconds: number;
    blockSeconds: number;
}

const BACKOFF_WINDOWS: BackoffWindow[] = [
    { minFailures: 15, windowSeconds: 900, blockSeconds: 900 },  // 15+ fallos en 15min → bloqueo 15min
    { minFailures: 10, windowSeconds: 300, blockSeconds: 300 },  // 10+ fallos en 5min  → bloqueo 5min
    { minFailures: config.loginMaxFailures, windowSeconds: 60, blockSeconds: 60 }, // 5+ fallos en 1min → bloqueo 1min
];

/**
 * Registra el resultado de un intento de login en la tabla login_attempts.
 * Debe llamarse desde el route handler tras procesar el login.
 */
export async function recordLoginAttempt(ip: string, email: string, success: boolean): Promise<void> {
    try {
        await db.query(
            `INSERT INTO login_attempts (ip, email, success, created_at) VALUES ($1, $2, $3, NOW())`,
            [ip, email.toLowerCase(), success]
        );
    } catch (err) {
        logger.error({ err }, 'Failed to record login attempt');
    }
}

/**
 * Middleware que bloquea IPs con demasiados intentos fallidos de login.
 * Aplica ventanas de backoff progresivo.
 */
export async function loginThrottle(req: Request, res: Response, next: NextFunction): Promise<void> {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ?? req.socket.remoteAddress ?? 'unknown';

    for (const window of BACKOFF_WINDOWS) {
        const { rows: [result] } = await db.query<{ count: number; last_at: Date }>(
            `SELECT COUNT(*)::int AS count, MAX(created_at) AS last_at
             FROM login_attempts
             WHERE ip = $1
               AND success = FALSE
               AND created_at > NOW() - INTERVAL '${window.windowSeconds} seconds'`,
            [ip]
        );

        if (result.count >= window.minFailures) {
            const lastAt = new Date(result.last_at);
            const unblockAt = new Date(lastAt.getTime() + window.blockSeconds * 1000);
            const retryAfter = Math.max(0, Math.ceil((unblockAt.getTime() - Date.now()) / 1000));

            if (retryAfter > 0) {
                logger.warn({ ip, failureCount: result.count, retryAfter }, 'Login throttled');
                res.status(429)
                    .set('Retry-After', String(retryAfter))
                    .json({
                        error: {
                            code: 'TOO_MANY_LOGIN_ATTEMPTS',
                            message: `Demasiados intentos fallidos. Espera ${retryAfter} segundos antes de volver a intentarlo.`,
                            retryAfter,
                        },
                    });
                return;
            }
        }
    }

    next();
}
