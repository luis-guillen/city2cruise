import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'staging';

/**
 * Hito 5.3.5 — Logging centralizado.
 *
 * En dev: pino-pretty (legible).
 * En staging/prod: JSON estructurado en stdout con campos:
 *   - level, time, msg, env, service, version
 *   - request_id, user_id (cuando se añaden via child logger en middleware)
 *
 * El colector (Better Stack / Grafana Loki / CloudWatch) consume stdout
 * desde Fly.io con el agent oficial. No hay que añadir SDK ni HTTP push:
 * mantiene 12-factor (logs como stream).
 */
export const logger = pino({
    level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    base: {
        env: process.env.NODE_ENV || 'development',
        service: 'city2cruise-backend',
        version: process.env.npm_package_version,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
        // Defensa de privacidad/seguridad: estos paths nunca llegan al colector
        paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.currentPassword',
            'req.body.newPassword',
            'password',
            '*.password',
            'jwt',
            'token',
            'secret',
        ],
        censor: '[REDACTED]',
    },
}, isDev
    ? pino.transport({
          target: 'pino-pretty',
          options: {
              colorize: true,
              translateTime: 'SYS:HH:MM:ss',
              ignore: 'pid,hostname,env,service,version',
          },
      })
    : undefined);

/**
 * Crea un child logger con request_id y user_id automáticos.
 * Usar desde middleware Express para que cada log de un request lleve
 * el request_id (correlation).
 */
export function withRequestContext(requestId: string, userId?: number) {
    return logger.child({ request_id: requestId, ...(userId ? { user_id: userId } : {}) });
}
