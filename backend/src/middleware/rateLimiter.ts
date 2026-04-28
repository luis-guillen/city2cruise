import rateLimit, { type Store } from 'express-rate-limit';
import { Request } from 'express';
import { RedisStore } from 'rate-limit-redis';
import { getRedis } from '../cache/redis';

const isTest = process.env.NODE_ENV === 'test';
const skipInTest = (_req: Request) => isTest;

/**
 * Hito 4.3.2 — Si hay Redis disponible, los limiters comparten
 * contador entre workers/instancias del cluster. Si no, fallback al
 * MemoryStore por defecto (rate limit por proceso, no global).
 */
function buildStore(prefix: string): Store | undefined {
  const redis = getRedis();
  if (!redis) return undefined;
  return new RedisStore({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sendCommand: (...args: string[]) => (redis as any).call(...args),
    prefix: `rl:${prefix}:`,
  }) as unknown as Store;
}


/** Límite global: 100 peticiones por IP cada minuto */
export const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    skip: skipInTest,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Demasiadas peticiones. Intenta de nuevo en unos segundos.' } },
    store: buildStore('globalLimiter'),
});

/** Límite estricto para login: 10 peticiones por IP cada minuto */
export const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    skip: skipInTest,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Demasiados intentos de login. Espera un momento.' } },
    store: buildStore('authLimiter'),
});

/** Límite estricto para apertura de taquilla: 5 intentos por IP cada minuto */
export const lockerOpenLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    skip: skipInTest,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Demasiados intentos de apertura. Espera un momento.' } },
    store: buildStore('lockerOpenLimiter'),
});
