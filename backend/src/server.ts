import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/env';
import apiRouter from './routes';
import debugRouter from './routes/debug';
import { globalErrorHandler } from './utils/errors';
import { globalLimiter } from './middleware/rateLimiter';

export const buildServer = (): Express => {
    const app = express();

    // 1. Cabeceras de seguridad HTTP (Helmet)
    app.use(helmet());

    // 2. CORS
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

    // 3. Rate Limiter Global
    app.use(globalLimiter);

    // 4. Body Parser con límite de tamaño (previene payload abuse)
    app.use(express.json({ limit: '16kb' }));

    // 5. Rutas
    app.use('/api', apiRouter);

    // 6. Debug (solo desarrollo)
    if (process.env.NODE_ENV !== 'production') {
        app.use('/debug', debugRouter);
    }

    // 7. Middleware de Manejo de Errores Global (Debe ser el último)
    app.use(globalErrorHandler);

    return app;
};
