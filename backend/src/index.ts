import http from 'http';
import { config } from './config/env';
import { initDB } from './db/database';
import { initSockets } from './sockets/io';
import { buildServer } from './server';
import { logger } from './utils/logger';
import { startPickupReminderScheduler, stopPickupReminderScheduler } from './jobs/pickupReminderJob';
import { startLockerSync, stopLockerSync } from './services/LockerSyncService';

const startServer = async () => {
    try {
        // 1. Iniciar Base de datos (ahora asíncrono con PostgreSQL)
        await initDB();

        // 2. Construir servidor Express
        const app = buildServer();
        const server = http.createServer(app);

        // 3. Inicializar Sockets en el mismo HTTP Server
        initSockets(server);

        // 4. Arrancar jobs periódicos
        startPickupReminderScheduler();
        startLockerSync();

        // 5. Arrancar listener
        server.listen(config.port, '0.0.0.0', () => {
            logger.info({ port: config.port, host: '0.0.0.0' }, 'Server running');
            logger.info({ url: `http://192.168.1.47:${config.port}/api/health` }, 'Health check');
        });

        // 6. Graceful shutdown
        const shutdown = () => {
            stopPickupReminderScheduler();
            stopLockerSync();
            server.close(() => process.exit(0));
        };
        process.once('SIGTERM', shutdown);
        process.once('SIGINT', shutdown);

    } catch (error) {
        logger.fatal({ err: error }, 'Fatal error during initialization');
        process.exit(1);
    }
};

startServer();
