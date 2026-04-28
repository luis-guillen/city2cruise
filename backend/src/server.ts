import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { config } from './config/env';
import apiRouter from './routes';
import debugRouter from './routes/debug';
import { stripeWebhookHandler } from './routes/payments';
import { globalErrorHandler } from './utils/errors';
import * as Sentry from '@sentry/node';
import { httpMetricsMiddleware, metricsHandler } from './observability/metrics';
import { globalLimiter } from './middleware/rateLimiter';

export const buildServer = (): Express => {
    const app = express();

    // 1. Cabeceras de seguridad HTTP (Helmet)
    app.use(helmet({
        // HSTS: 1 año, incluir subdomains
        hsts: {
            maxAge: 31_536_000,
            includeSubDomains: true,
            preload: true,
        },
        // CSP orientado a la API: bloquea todo lo que no sea el propio origen.
        // La SPA (Vite) tiene su propio CSP servido desde el CDN/Nginx.
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'none'"],
                objectSrc: ["'none'"],
                frameAncestors: ["'none'"],
            },
        },
        // Evita que el navegador infiera MIME types
        noSniff: true,
        // Oculta la cabecera X-Powered-By
        hidePoweredBy: true,
        // Bloquea iframes de cualquier origen
        frameguard: { action: 'deny' },
        // XSS filter legacy (IE)
        xssFilter: true,
    }));

    // 2. Cookie parser (necesario para refresh token HttpOnly)
    app.use(cookieParser());

    // 3. CORS
    const allowedOrigins = [config.frontendUrl, 'http://localhost:9100', 'http://localhost:9101', 'http://localhost:9102', 'http://localhost:9103'];
    app.use(cors({
        origin: (origin, callback) => {
            // Permitir peticiones sin origen (como mobile apps o curl)
            if (!origin) return callback(null, true);
            if (
                allowedOrigins.indexOf(origin) !== -1 || 
                origin.startsWith('http://localhost:') || 
                (process.env.NODE_ENV !== 'production' && origin.startsWith('http://192.168.'))
            ) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        },
        credentials: true
    }));

    // 4a. Hito 4.3.4 — Compresion gzip/brotli y ETag.
    // - Compresion solo si la respuesta supera 1KB y no es WebSocket.
    // - El header X-No-Compression desactiva la compresion (util para
    //   debugging via curl).
    app.use(
        compression({
            threshold: 1024,
            filter: (req, res) => {
                if (req.headers['x-no-compression']) return false;
                return compression.filter(req, res);
            },
        }),
    );
    // ETag fuerte por contenido (Express ya lo incluye, lo hacemos explicito).
    app.set('etag', 'strong');

    // 4b. Rate Limiter Global
    app.use(globalLimiter);

    // 5a. Webhook de Stripe — necesita body RAW antes de que express.json lo parsee
    app.post(
        '/webhooks/stripe',
        express.raw({ type: 'application/json' }),
        stripeWebhookHandler,
    );

    // 5b. Body Parser con límite de tamaño (previene payload abuse)
    app.use(express.json({ limit: '16kb' }));

    // 5b. Métricas Prometheus (Hito 5.3.2)
    app.use(httpMetricsMiddleware);
    app.get('/metrics', metricsHandler);

    // 6. Rutas
    app.use('/api', apiRouter);

    // 7. Debug (solo desarrollo)
    if (process.env.NODE_ENV !== 'production') {
        app.use('/debug', debugRouter);
    }

    // 8a. Sentry error handler (Hito 5.3.1) — captura todo lo que llega aquí
    Sentry.setupExpressErrorHandler(app);

    // 8. Middleware de Manejo de Errores Global (Debe ser el último)
    app.use(globalErrorHandler);

    return app;
};
