import fs from 'fs/promises';
import path from 'path';
import request from 'supertest';
import crypto from 'crypto';
import {
    setupTestDb,
    teardownTestDb,
    createTestApp,
    getClientToken,
    getDriverToken,
    getDriver2Token,
    getTestPool,
} from './helpers';
import {
    __test__ as custodyTestHooks,
    finalizeCustodyCommit,
    prepareCustodyCommit,
    resetCustodyLedgerForTests,
    verifyRequestCustodyProof,
} from '../services/CustodyLedgerService';

jest.mock('../sockets/io', () => ({
    emitEvent: jest.fn(),
    emitToUser: jest.fn(),
    emitToSocket: jest.fn(),
    initSockets: jest.fn(),
    getActiveDrivers: jest.fn(() => []),
}));

jest.mock('../db/database', () => {
    const actual = jest.requireActual('../db/database');
    return { ...actual, initDB: jest.fn() };
});

let app: any;
let clientToken: string;
let driverToken: string;
let driver2Token: string;
let clientKeyPair: any;
let driverKeyPair: any;
let rogueKeyPair: any;

async function exportPublicKeyJwk(key: any): Promise<JsonWebKey> {
    return crypto.webcrypto.subtle.exportKey('jwk', key);
}

async function signMessage(key: any, message: string): Promise<string> {
    const sig = await crypto.webcrypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        new TextEncoder().encode(message),
    );
    return Buffer.from(sig).toString('base64url');
}

async function registerSigningKeys() {
    await request(app)
        .post('/api/custody/signing-key/register')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ algorithm: 'ECDSA_P256_SHA256', publicKeyJwk: await exportPublicKeyJwk(clientKeyPair.publicKey) })
        .expect(201);

    await request(app)
        .post('/api/custody/signing-key/register')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ algorithm: 'ECDSA_P256_SHA256', publicKeyJwk: await exportPublicKeyJwk(driverKeyPair.publicKey) })
        .expect(201);
}

async function createAssignedRequest() {
    const createRes = await request(app)
        .post('/api/requests')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ pickupLocation: 'Terminal Puerto de La Luz, Las Palmas', packageSize: 'SMALL' })
        .expect(200);

    const acceptRes = await request(app)
        .post(`/api/requests/${createRes.body.id}/accept`)
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(200);

    return {
        requestId: createRes.body.id as number,
        challengeId: acceptRes.body.custodyChallenge.id as string,
        handshakeCode: acceptRes.body.handshakeCode as string,
    };
}

beforeAll(async () => {
    await setupTestDb();
    app = createTestApp();
    clientToken = getClientToken();
    driverToken = getDriverToken();
    driver2Token = getDriver2Token();
    clientKeyPair = await crypto.webcrypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
    );
    driverKeyPair = await crypto.webcrypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
    );
    rogueKeyPair = await crypto.webcrypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
    );
    await registerSigningKeys();
});

afterAll(async () => {
    await teardownTestDb();
});

describe('Custody ledger hardening', () => {
    it('rechaza leer un challenge desde un usuario ajeno a la solicitud', async () => {
        const { challengeId } = await createAssignedRequest();

        const res = await request(app)
            .get(`/api/custody/challenges/${challengeId}`)
            .set('Authorization', `Bearer ${driver2Token}`);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rechaza firmas inválidas aunque el actor tenga una clave registrada', async () => {
        const { challengeId } = await createAssignedRequest();

        const challengeRes = await request(app)
            .get(`/api/custody/challenges/${challengeId}`)
            .set('Authorization', `Bearer ${clientToken}`)
            .expect(200);

        const badSignature = await signMessage(rogueKeyPair.privateKey, challengeRes.body.canonicalMessage);
        const res = await request(app)
            .post(`/api/custody/challenges/${challengeId}/sign`)
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ signature: badSignature });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    });

    it('rechaza una transición de depósito antes de completar el handshake', async () => {
        const { requestId } = await createAssignedRequest();

        const res = await request(app)
            .post('/api/custody/challenges')
            .set('Authorization', `Bearer ${driverToken}`)
            .send({ requestId, eventType: 'DEPOSITED' });

        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('CONFLICT');
    });

    it('rechaza replay de un challenge ya comprometido', async () => {
        const { requestId, challengeId, handshakeCode } = await createAssignedRequest();

        const challengeRes = await request(app)
            .get(`/api/custody/challenges/${challengeId}`)
            .set('Authorization', `Bearer ${clientToken}`)
            .expect(200);

        const driverSignature = await signMessage(driverKeyPair.privateKey, challengeRes.body.canonicalMessage);
        await request(app)
            .post(`/api/custody/challenges/${challengeId}/sign`)
            .set('Authorization', `Bearer ${driverToken}`)
            .send({ signature: driverSignature })
            .expect(200);

        const clientSignature = await signMessage(clientKeyPair.privateKey, challengeRes.body.canonicalMessage);
        await request(app)
            .post(`/api/custody/challenges/${challengeId}/sign`)
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ signature: clientSignature })
            .expect(200);

        await request(app)
            .post(`/api/requests/${requestId}/confirm-driver`)
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ handshakeCode, challengeId })
            .expect(200);

        const replayRes = await request(app)
            .post(`/api/custody/challenges/${challengeId}/sign`)
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ signature: clientSignature });

        expect(replayRes.status).toBe(409);
        expect(replayRes.body.error.code).toBe('CONFLICT');
    });

    it('revierte commits parciales si el quórum del ledger cae por debajo de 2/3', async () => {
        const { challengeId } = await createAssignedRequest();

        const challengeRes = await request(app)
            .get(`/api/custody/challenges/${challengeId}`)
            .set('Authorization', `Bearer ${clientToken}`)
            .expect(200);

        const driverSignature = await signMessage(driverKeyPair.privateKey, challengeRes.body.canonicalMessage);
        await request(app)
            .post(`/api/custody/challenges/${challengeId}/sign`)
            .set('Authorization', `Bearer ${driverToken}`)
            .send({ signature: driverSignature })
            .expect(200);

        const clientSignature = await signMessage(clientKeyPair.privateKey, challengeRes.body.canonicalMessage);
        await request(app)
            .post(`/api/custody/challenges/${challengeId}/sign`)
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ signature: clientSignature })
            .expect(200);

        const prepared = await prepareCustodyCommit({
            challengeId,
            eventType: 'HANDSHAKE_VALIDATED',
        });

        await Promise.all(['ledger-b', 'ledger-c'].map(async (validatorId) => {
            await fs.unlink(path.join(custodyTestHooks.ledgerBaseDir, validatorId, 'pending', `${prepared.proposalId}.json`));
        }));

        await expect(finalizeCustodyCommit(prepared.proposalId)).rejects.toMatchObject({
            code: 'LEDGER_QUORUM_FAILED',
        });

        const validatorLedgers = await Promise.all(custodyTestHooks.validatorIds.map(async (validatorId) => {
            const raw = await fs.readFile(path.join(custodyTestHooks.ledgerBaseDir, validatorId, 'ledger.json'), 'utf8');
            return JSON.parse(raw) as { validatorId: string; blocks: Array<{ proposalId: string }> };
        }));

        for (const ledger of validatorLedgers) {
            expect(ledger.blocks.some((block) => block.proposalId === prepared.proposalId)).toBe(false);
        }
    });

    it('sincroniza el certificado final con los votos reales de los validadores que formaron quórum', async () => {
        const pool = getTestPool();
        await pool.query('DELETE FROM audit_events');
        await pool.query('DELETE FROM custody_challenges');
        await pool.query('DELETE FROM pickup_requests');
        await pool.query('UPDATE lockers SET is_occupied = FALSE, current_request_id = NULL, access_code = NULL, updated_at = NOW()');
        await resetCustodyLedgerForTests();

        const { requestId, challengeId, handshakeCode } = await createAssignedRequest();

        const challengeRes = await request(app)
            .get(`/api/custody/challenges/${challengeId}`)
            .set('Authorization', `Bearer ${clientToken}`)
            .expect(200);

        const driverSignature = await signMessage(driverKeyPair.privateKey, challengeRes.body.canonicalMessage);
        await request(app)
            .post(`/api/custody/challenges/${challengeId}/sign`)
            .set('Authorization', `Bearer ${driverToken}`)
            .send({ signature: driverSignature })
            .expect(200);

        const clientSignature = await signMessage(clientKeyPair.privateKey, challengeRes.body.canonicalMessage);
        await request(app)
            .post(`/api/custody/challenges/${challengeId}/sign`)
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ signature: clientSignature })
            .expect(200);

        await request(app)
            .post(`/api/requests/${requestId}/confirm-driver`)
            .set('Authorization', `Bearer ${clientToken}`)
            .send({ handshakeCode, challengeId })
            .expect(200);

        const ledgers = await Promise.all(custodyTestHooks.validatorIds.map(async (validatorId) => {
            const raw = await fs.readFile(path.join(custodyTestHooks.ledgerBaseDir, validatorId, 'ledger.json'), 'utf8');
            return JSON.parse(raw) as {
                validatorId: string;
                blocks: Array<{
                    requestId: number;
                    validatorCommitCertificate: Array<{ validatorId: string; committedAt: string; signature: string }>;
                }>;
            };
        }));

        const requestBlocks = ledgers
            .map((ledger) => ledger.blocks.find((block) => block.requestId === requestId))
            .filter((block): block is NonNullable<typeof block> => !!block);

        expect(requestBlocks.length).toBeGreaterThanOrEqual(2);
        for (const block of requestBlocks) {
            expect(block.validatorCommitCertificate.length).toBe(requestBlocks.length);
        }

        const certificateFingerprint = JSON.stringify(requestBlocks[0].validatorCommitCertificate);
        for (const block of requestBlocks.slice(1)) {
            expect(JSON.stringify(block.validatorCommitCertificate)).toBe(certificateFingerprint);
        }

        const verification = await verifyRequestCustodyProof(requestId);
        expect(verification.verified).toBe(true);
    });
});
