/**
 * Hito H-2.2 (S-08) — Logger del frontend.
 *
 * Sustituye al uso directo de `console.log` en código de producción. En
 * desarrollo redirige a la consola para conservar la DX; en producción los
 * niveles `info`/`debug` se silencian (no envenenan los logs del navegador
 * del usuario final) y los `error` se reportan a Sentry.
 *
 * Uso:
 *   import { logger } from '@/utils/logger';
 *   logger.debug('socket event', payload);
 *   logger.error(err, { context: 'useSocket' });
 */
import * as Sentry from '@sentry/react';

const isDev = import.meta.env.DEV;

export const logger = {
    debug: (...args: unknown[]): void => {
        if (isDev) {
            // eslint-disable-next-line no-console
            console.debug(...args);
        }
    },
    info: (...args: unknown[]): void => {
        if (isDev) {
            // eslint-disable-next-line no-console
            console.info(...args);
        }
    },
    warn: (...args: unknown[]): void => {
        // En prod sigue saliendo por consola por seguridad operativa, además
        // del breadcrumb que Sentry captura automáticamente.
        console.warn(...args);
    },
    error: (err: unknown, extra?: Record<string, unknown>): void => {
        try {
            Sentry.captureException(err, extra ? { extra } : undefined);
        } catch {
            // Sentry puede no estar inicializado (tests, dev sin DSN).
        }
        if (isDev) {
            console.error(err, extra);
        }
    },
};
