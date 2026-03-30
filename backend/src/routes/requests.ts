import { Router } from 'express';
import { z } from 'zod';
import { sendError, ServiceError } from '../utils/errors';
import { sanitizeForSocket } from '../utils/dto';
import { emitEvent, emitToUser, getActiveDrivers } from '../sockets/io';
import { config } from '../config/env';
import { authMiddleware, requireRole } from '../auth/middleware';
import { acceptSchema } from '../schemas/request.schemas';
import { validateBody } from '../middleware/validateSchema';
import { createRequestSchema, confirmDriverSchema, depositSchema } from '../schemas/request.schemas';
import * as RequestService from '../services/RequestService';

const requestsRouter = Router();

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

/** Helper: lanza ServiceError como sendError; re-lanza el resto. */
function handleServiceError(err: unknown, res: any): never | void {
    if (err instanceof ServiceError) {
        if (err.extra) {
            return res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.extra } });
        }
        return sendError(res, err.status, err.code, err.message);
    }
    throw err;
}

// ======================================
// ENDPOINTS DEL CLIENTE
// ======================================

// POST /requests
requestsRouter.post('/', authMiddleware, requireRole('CLIENT'), validateBody(createRequestSchema), async (req, res) => {
    try {
        const data = req.body;
        const { dto } = await RequestService.createRequest({
            userId: req.user!.id,
            userName: req.user!.name,
            pickupLocation: data.pickupLocation,
            latitude: data.latitude ?? null,
            longitude: data.longitude ?? null,
            packageSize: data.packageSize,
            merchantId: data.merchantId,
        });
        res.json(dto);
    } catch (err) {
        handleServiceError(err, res);
    }
});

// GET /requests/mine
requestsRouter.get('/mine', authMiddleware, requireRole('CLIENT'), async (req, res) => {
    const dto = await RequestService.getClientCurrent({ userId: req.user!.id });
    res.json(dto);
});

// GET /requests/history
requestsRouter.get('/history', authMiddleware, requireRole('CLIENT'), async (req, res) => {
    const dtos = await RequestService.getClientHistory({ userId: req.user!.id });
    res.json(dtos);
});

// ======================================
// ENDPOINTS DEL CONDUCTOR (DRIVER)
// ======================================

// GET /requests/pending
requestsRouter.get('/pending', authMiddleware, requireRole('DRIVER'), async (req, res) => {
    let lat = req.query.lat ? parseFloat(req.query.lat as string) : null;
    let lon = req.query.lon ? parseFloat(req.query.lon as string) : null;
    let radius = req.query.radius ? parseFloat(req.query.radius as string) : null;

    if (lat === null || lon === null) {
        const drivers = getActiveDrivers();
        const me = drivers.find(d => d.userId === req.user!.id);
        if (me) {
            lat = me.lat;
            lon = me.lon;
            if (radius === null) radius = 3;
        } else {
            return res.json([]);
        }
    }

    const dtos = await RequestService.getPendingRequests({ driverId: req.user!.id, lat, lon, radius });
    res.json(dtos);
});

// GET /requests/my-pickups
requestsRouter.get('/my-pickups', authMiddleware, requireRole('DRIVER'), async (req, res) => {
    const dtos = await RequestService.getDriverPickups({ driverId: req.user!.id });
    res.json(dtos);
});

// POST /requests/:id/accept
requestsRouter.post('/:id/accept', authMiddleware, requireRole('DRIVER'), async (req, res) => {
    const reqId = String(req.params.id);
    if (!/^\d+$/.test(reqId)) {
        return sendError(res, 400, 'BAD_REQUEST', 'ID de pedido inválido');
    }

    let bodyData: z.infer<typeof acceptSchema> = {};
    try { bodyData = acceptSchema.parse(req.body); } catch (e) { /* silent */ }

    if (config.simulateRace) await delay(50);

    try {
        const { dto, handshakeCode } = await RequestService.acceptRequest({
            requestId: reqId,
            driverId: req.user!.id,
            driverName: req.user!.name,
            driverLat: bodyData.driverLat,
            driverLon: bodyData.driverLon,
            radiusKm: bodyData.radiusKm,
        });
        dto.handshakeCode = handshakeCode;
        emitEvent('request:updated', sanitizeForSocket(dto));
        res.json(dto);
    } catch (err) {
        handleServiceError(err, res);
    }
});

// POST /requests/:id/confirm-driver
requestsRouter.post('/:id/confirm-driver', authMiddleware, requireRole('CLIENT'), validateBody(confirmDriverSchema), async (req, res) => {
    const reqId = String(req.params.id);
    try {
        const { handshakeCode, latitude: clientLat, longitude: clientLon } = req.body;
        const { dto } = await RequestService.confirmHandshake({
            requestId: reqId,
            clientId: req.user!.id,
            handshakeCode,
            clientLat,
            clientLon,
        });
        emitEvent('request:updated', sanitizeForSocket(dto));
        res.json(dto);
    } catch (err) {
        handleServiceError(err, res);
    }
});

// POST /requests/:id/renew-handshake
requestsRouter.post('/:id/renew-handshake', authMiddleware, requireRole('DRIVER'), async (req, res) => {
    const reqId = String(req.params.id);
    try {
        const { dto, newCode } = await RequestService.renewHandshake({
            requestId: reqId,
            driverId: req.user!.id,
        });
        dto.handshakeCode = newCode;
        emitEvent('request:updated', sanitizeForSocket(dto));
        res.json(dto);
    } catch (err) {
        handleServiceError(err, res);
    }
});

// POST /requests/:id/deposit
requestsRouter.post('/:id/deposit', authMiddleware, requireRole('DRIVER'), validateBody(depositSchema), async (req, res) => {
    const reqId = String(req.params.id);
    if (!/^\d+$/.test(reqId)) {
        return sendError(res, 400, 'BAD_REQUEST', 'ID de pedido inválido');
    }

    if (config.simulateRace) await delay(50);

    try {
        const { dto, lockerCode, clientId, notification, locker } = await RequestService.depositRequest({
            requestId: reqId,
            driverId: req.user!.id,
            lockerLabel: req.body.lockerLabel,
        });

        emitToUser(clientId, 'locker:ready', {
            requestId: dto.id,
            locker,
            lockerCode,
        });
        emitToUser(clientId, 'notification:new', notification);
        emitEvent('request:updated', sanitizeForSocket(dto));

        res.json(dto);
    } catch (err) {
        handleServiceError(err, res);
    }
});

export default requestsRouter;
