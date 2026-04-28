/**
 * Hito 5.3.1 — Sentry APM (backend)
 *
 * Inicialización idempotente de Sentry para Node. Se importa primero en
 * `index.ts` para que pueda instrumentar HTTP/Express/PG automáticamente
 * (Sentry v8 usa OTel bajo el capó, requiere import temprano).
 */
import * as Sentry from '@sentry/node';

let initialized = false;

export function initSentry(): boolean {
    if (initialized) return true;

    const dsn = process.env.SENTRY_DSN;
    const env = process.env.NODE_ENV || 'development';

    if (!dsn) {
        if (env === 'production' || env === 'staging') {
            // eslint-disable-next-line no-console
            console.warn('[sentry] SENTRY_DSN no definido en', env, '— observabilidad desactivada');
        }
        return false;
    }

    Sentry.init({
        dsn,
        environment: process.env.SENTRY_ENVIRONMENT || env,
        release: process.env.SENTRY_RELEASE || process.env.npm_package_version,

        tracesSampleRate: env === 'production'
            ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1')
            : 1.0,

        profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE || '0'),

        ignoreErrors: [
            /Bad Request/i,
            'ECONNRESET',
            'ETIMEDOUT',
        ],

        beforeSend(event) {
            if (event.user) {
                delete event.user.ip_address;
            }
            if (event.request?.headers) {
                delete event.request.headers.authorization;
                delete event.request.headers.cookie;
            }
            return event;
        },
    });

    initialized = true;
    // eslint-disable-next-line no-console
    console.log('[sentry] inicializado en', env, 'release', process.env.SENTRY_RELEASE || 'dev');
    return true;
}

export { Sentry };
