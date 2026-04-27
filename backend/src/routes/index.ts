import { Router } from 'express';
import { db } from '../db/database';
import { config } from '../config/env';
import authRouter from './auth';
import requestsRouter from './requests';
import lockersRouter from './lockers';
import adminRouter from './admin';
import locationsRouter from './locations';
import notificationsRouter from './notifications';
import merchantsRouter from './merchants';
import cruisesRouter from './cruises';
import paymentsRouter from './payments';
import { authLimiter, lockerOpenLimiter } from '../middleware/rateLimiter';

const apiRouter = Router();
const v1Router = Router();

// Endpoint temporal para depuración del estado completo (Solo DEV)
if (config.env === 'development') {
    v1Router.get('/debug/full-state', async (req, res) => {
        const { rows: users } = await db.query('SELECT id, name, role FROM users');
        const { rows: lockers } = await db.query('SELECT * FROM lockers');
        const { rows: requests } = await db.query('SELECT * FROM pickup_requests');

        res.json({ users, lockers, requests });
    });
}

// APIs con rate limiters específicos
v1Router.use('/auth', authLimiter, authRouter);
v1Router.use('/requests', requestsRouter);
v1Router.use('/lockers', lockerOpenLimiter, lockersRouter);
v1Router.use('/admin', adminRouter);
v1Router.use('/locations', locationsRouter);
v1Router.use('/notifications', notificationsRouter);
v1Router.use('/merchants', merchantsRouter);
v1Router.use('/cruises', cruisesRouter);
v1Router.use('/payments', paymentsRouter);

// Health Check Endpoint (fuera de versionado específico, pero indicando la versión)
apiRouter.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', version: 'v1', timestamp: new Date().toISOString() });
});

// Montar v1
apiRouter.use('/v1', v1Router);

// COMPATIBILIDAD: mantener rutas sin versión como alias de v1 (deprecar en futuro)
apiRouter.use('/', v1Router);

export default apiRouter;
