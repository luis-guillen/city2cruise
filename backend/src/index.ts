// Hito 5.3.1 — Sentry debe inicializarse ANTES que cualquier otro import
import { initSentry } from './observability/sentry';
initSentry();

import http from 'http';
import { config } from './config/env';
import { initDB } from './db/database';
import { initSockets } from './sockets/io';
import { buildServer } from './server';
import { logger } from './utils/logger';
import { startPickupReminderScheduler, stopPickupReminderScheduler } from './jobs/pickupReminderJob';
import { startRebalanceScheduler, stopRebalanceScheduler } from './jobs/rebalanceFleetJob';
import { startLockerSync, stopLockerSync } from './services/LockerSyncService';
import { bootstrap } from './cluster';

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
        startRebalanceScheduler();
        startLockerSync();

        // 5. Arrancar listener
        server.listen(config.port, '0.0.0.0', () => {
            logger.info({ port: config.port, host: '0.0.0.0' }, 'Server running');
            logger.info({ url: `http://192.168.1.47:${config.port}/api/health` }, 'Health check');
        });

        // 6. Graceful shutdown
        const shutdown = () => {
            stopPickupReminderScheduler();
            stopRebalanceScheduler();
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

// Hito 4.3.1 — Si CLUSTER_ENABLED=1 (o NODE_ENV=production), arranca
// N workers via node:cluster; si no, single-process como antes.
bootstrap(startServer);
