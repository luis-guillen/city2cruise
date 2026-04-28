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
import { globalLimiter } from './middleware/rateLimiter';

export const buildServer = (): Express => {
    const app = express();

    // 1. Compresión gzip/brotli de respuestas JSON (antes de cualquier ruta)
    app.use(compression());

    // 2. Cabeceras de seguridad HTTP (Helmet)
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

    // 3. Cookie parser (necesario para refresh token HttpOnly)
    app.use(cookieParser());

    // 4. CORS
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

    // 5. Rate Limiter Global
    app.use(globalLimiter);

    // 5a. Webhook de Stripe — necesita body RAW antes de que express.json lo parsee
    app.post(
        '/webhooks/stripe',
        express.raw({ type: 'application/json' }),
        stripeWebhookHandler,
    );

    // 5b. Body Parser con límite de tamaño (previene payload abuse)
    app.use(express.json({ limit: '16kb' }));

    // 6. Rutas
    app.use('/api', apiRouter);

    // 7. Debug (solo desarrollo)
    if (process.env.NODE_ENV !== 'production') {
        app.use('/debug', debugRouter);
    }

    // 8. Middleware de Manejo de Errores Global (Debe ser el último)
    app.use(globalErrorHandler);

    return app;
};
