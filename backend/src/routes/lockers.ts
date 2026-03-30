import { Router } from 'express';
import { db } from '../db/database';
import { authMiddleware, requireRole } from '../auth/middleware';
import { sendError, ServiceError } from '../utils/errors';
import { sanitizeForSocket } from '../utils/dto';
import { emitEvent } from '../sockets/io';
import { config } from '../config/env';
import { openLockerSchema } from '../schemas/locker.schemas';
import { validateBody } from '../middleware/validateSchema';
import * as LockerService from '../services/LockerService';

const lockersRouter = Router();

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

// POST /lockers/open (CLIENT)
lockersRouter.post('/open', authMiddleware, requireRole('CLIENT'), validateBody(openLockerSchema), async (req, res) => {
    try {
        if (config.simulateRace) await delay(50);

        const { dto } = await LockerService.openLocker({
            lockerCode: req.body.lockerCode,
            userId: req.user!.id,
            userName: req.user!.name,
        });

        emitEvent('request:updated', sanitizeForSocket(dto));
        res.json(dto);
    } catch (err) {
        if (err instanceof ServiceError) {
            return sendError(res, err.status, err.code, err.message);
        }
        throw err;
    }
});

export default lockersRouter;
