import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth/middleware';
import { requireRole } from '../auth/middleware';
import { sendError, ServiceError } from '../utils/errors';
import {
    getSigningIdentity,
    registerOrRotateSigningKey,
    getOrCreateCustodyChallenge,
    getCustodyChallengeForActor,
    signCustodyChallenge,
    getQuorumHealth,
    ValidatorHealthEntry,
} from '../services/CustodyLedgerService';

const custodyRouter = Router();

const signingKeySchema = z.object({
    algorithm: z.literal('ECDSA_P256_SHA256'),
    publicKeyJwk: z.object({
        kty: z.literal('EC'),
        crv: z.literal('P-256'),
        x: z.string().min(1),
        y: z.string().min(1),
    }),
});

const createChallengeSchema = z.object({
    requestId: z.number().int().positive(),
    eventType: z.enum(['HANDSHAKE_VALIDATED', 'DEPOSITED', 'PICKED_UP']),
});

const signChallengeSchema = z.object({
    signature: z.string().min(32),
});

function handleServiceError(err: unknown, res: any): void {
    if (err instanceof ServiceError) {
        return sendError(res, err.status, err.code, err.message);
    }
    throw err;
}

custodyRouter.get('/signing-key', authMiddleware, async (req, res) => {
    try {
        const identity = await getSigningIdentity(req.user!.id);
        res.json(identity);
    } catch (err) {
        handleServiceError(err, res);
    }
});

custodyRouter.post('/signing-key/register', authMiddleware, async (req, res) => {
    try {
        const data = signingKeySchema.parse(req.body);
        const identity = await registerOrRotateSigningKey({
            userId: req.user!.id,
            algorithm: data.algorithm,
            publicKeyJwk: data.publicKeyJwk,
            rotate: false,
        });
        res.status(201).json(identity);
    } catch (err) {
        if (err instanceof z.ZodError) {
            return sendError(res, 400, 'BAD_REQUEST', 'Payload de clave criptográfica inválido');
        }
        handleServiceError(err, res);
    }
});

custodyRouter.post('/signing-key/rotate', authMiddleware, async (req, res) => {
    try {
        const data = signingKeySchema.parse(req.body);
        const identity = await registerOrRotateSigningKey({
            userId: req.user!.id,
            algorithm: data.algorithm,
            publicKeyJwk: data.publicKeyJwk,
            rotate: true,
        });
        res.json(identity);
    } catch (err) {
        if (err instanceof z.ZodError) {
            return sendError(res, 400, 'BAD_REQUEST', 'Payload de clave criptográfica inválido');
        }
        handleServiceError(err, res);
    }
});

custodyRouter.post('/challenges', authMiddleware, async (req, res) => {
    try {
        const data = createChallengeSchema.parse(req.body);
        const challenge = await getOrCreateCustodyChallenge({
            requestId: data.requestId,
            eventType: data.eventType,
            requesterId: req.user!.id,
            requesterRole: req.user!.role,
            eventPayload: {},
        });
        res.status(201).json(challenge);
    } catch (err) {
        if (err instanceof z.ZodError) {
            return sendError(res, 400, 'BAD_REQUEST', 'Payload de challenge inválido');
        }
        handleServiceError(err, res);
    }
});

custodyRouter.get('/challenges/:id', authMiddleware, async (req, res) => {
    try {
        const challenge = await getCustodyChallengeForActor({
            challengeId: String(req.params.id),
            actorId: req.user!.id,
            actorRole: req.user!.role,
        });
        res.json(challenge);
    } catch (err) {
        handleServiceError(err, res);
    }
});

custodyRouter.post('/challenges/:id/sign', authMiddleware, async (req, res) => {
    try {
        const data = signChallengeSchema.parse(req.body);
        const challenge = await signCustodyChallenge({
            challengeId: String(req.params.id),
            actorId: req.user!.id,
            signature: data.signature,
        });
        res.json(challenge);
    } catch (err) {
        if (err instanceof z.ZodError) {
            return sendError(res, 400, 'BAD_REQUEST', 'Payload de firma inválido');
        }
        handleServiceError(err, res);
    }
});

custodyRouter.get('/quorum-health', authMiddleware, requireRole('ADMIN'), async (_req, res) => {
    try {
        const health = await getQuorumHealth();
        const allOk = health.every((v: ValidatorHealthEntry) => v.status === 'ok');
        res.status(allOk ? 200 : 503).json({ quorum: health, healthy: allOk });
    } catch (err) {
        handleServiceError(err, res);
    }
});

export default custodyRouter;
