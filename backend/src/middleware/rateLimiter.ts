import rateLimit from 'express-rate-limit';
import { Request } from 'express';

const isTest = process.env.NODE_ENV === 'test';
const skipInTest = (_req: Request) => isTest;

/** Límite global: 100 peticiones por IP cada minuto */
export const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    skip: skipInTest,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Demasiadas peticiones. Intenta de nuevo en unos segundos.' } },
});

/** Límite estricto para login: 10 peticiones por IP cada minuto */
export const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    skip: skipInTest,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Demasiados intentos de login. Espera un momento.' } },
});

/** Límite estricto para apertura de taquilla: 5 intentos por IP cada minuto */
export const lockerOpenLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    skip: skipInTest,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Demasiados intentos de apertura. Espera un momento.' } },
});
