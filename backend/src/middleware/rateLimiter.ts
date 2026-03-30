import rateLimit from 'express-rate-limit';

/** Límite global: 100 peticiones por IP cada minuto */
export const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Demasiadas peticiones. Intenta de nuevo en unos segundos.' } },
});

/** Límite estricto para login: 10 peticiones por IP cada minuto */
export const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Demasiados intentos de login. Espera un momento.' } },
});

/** Límite estricto para apertura de taquilla: 5 intentos por IP cada minuto */
export const lockerOpenLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Demasiados intentos de apertura. Espera un momento.' } },
});
