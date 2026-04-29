/**
 * Hito 5.3.1 — Sentry APM (frontend React)
 *
 * Inicialización idempotente. Se llama desde main.tsx ANTES de crear el
 * root de React para que la instrumentación capture errores tempranos.
 */
import * as Sentry from '@sentry/react';

let initialized = false;

export function initSentry(): boolean {
    if (initialized) return true;

    const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
    const env = (import.meta.env.VITE_ENV as string) || import.meta.env.MODE;

    if (!dsn) {
        if (env === 'production' || env === 'staging') {
            console.warn('[sentry] VITE_SENTRY_DSN no definido en', env);
        }
        return false;
    }

    Sentry.init({
        dsn,
        environment: env,
        release: import.meta.env.VITE_RELEASE as string | undefined,

        integrations: [
            Sentry.browserTracingIntegration(),
            // Replay on errors only — el coste/legal de session replay completo
            // no compensa para esta app
            Sentry.replayIntegration({
                maskAllText: true,
                blockAllMedia: true,
            }),
        ],

        tracesSampleRate: env === 'production' ? 0.1 : 1.0,

        // Replay sólo cuando hay error
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 1.0,

        // Ignorar ruido conocido
        ignoreErrors: [
            // Extensiones de Chrome inyectando código
            /chrome-extension:\/\//,
            /moz-extension:\/\//,
            // Network noise
            'Network request failed',
            'Failed to fetch',
            'Load failed',
            // ResizeObserver loop, no afecta a UX
            'ResizeObserver loop limit exceeded',
            'ResizeObserver loop completed with undelivered notifications',
        ],

        denyUrls: [
            // No reportar errores que vengan de third-parties cargados externamente
            /^chrome:\/\//,
            /^chrome-extension:\/\//,
        ],

        beforeSend(event) {
            // Scrub Authorization headers
            if (event.request?.headers) {
                delete (event.request.headers as Record<string, string>)['Authorization'];
                delete (event.request.headers as Record<string, string>)['Cookie'];
            }
            return event;
        },
    });

    initialized = true;
    return true;
}

export { Sentry };
