import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createId } from '@paralleldrive/cuid2';
import { db } from '../db/database';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { ServiceError } from '../utils/errors';

// When VALIDATOR_LEDGER_A_URL is set, all ledger I/O goes over HTTP to the
// independent validator processes. Otherwise (tests, local dev without Docker)
// the embedded file-based implementation is used.
const VALIDATOR_HTTP_URLS: Record<string, string | undefined> = {
    'ledger-a': process.env.VALIDATOR_LEDGER_A_URL,
    'ledger-b': process.env.VALIDATOR_LEDGER_B_URL,
    'ledger-c': process.env.VALIDATOR_LEDGER_C_URL,
};
const USE_HTTP_VALIDATORS = !!(
    process.env.VALIDATOR_LEDGER_A_URL &&
    process.env.VALIDATOR_LEDGER_B_URL &&
    process.env.VALIDATOR_LEDGER_C_URL
);
const VALIDATOR_INTERNAL_KEY = process.env.VALIDATOR_INTERNAL_KEY || 'dev_validator_key';

async function validatorFetch(
    validatorId: string,
    endpoint: string,
    options: RequestInit = {},
): Promise<Response> {
    const base = VALIDATOR_HTTP_URLS[validatorId];
    if (!base) throw new Error(`No URL configured for validator ${validatorId}`);
    return fetch(`${base}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'X-Validator-Key': VALIDATOR_INTERNAL_KEY,
            ...(options.headers as Record<string, string> | undefined),
        },
    });
}

export type CriticalCustodyEventType = 'HANDSHAKE_VALIDATED' | 'DEPOSITED' | 'PICKED_UP';
type SigningKeyAlgorithm = 'ECDSA_P256_SHA256';
type SigningKeyStatus = 'UNREGISTERED' | 'ACTIVE' | 'REVOKED';
type CustodyChallengeStatus = 'PENDING' | 'COMMITTED' | 'REVOKED' | 'EXPIRED';
type CustodyRole = 'CLIENT' | 'DRIVER' | 'LOCKER_SYSTEM';

interface PublicKeyJwk {
    kty: 'EC';
    crv: 'P-256';
    x: string;
    y: string;
}

interface UserSigningKeyRow {
    id: number;
    role: 'CLIENT' | 'DRIVER' | 'ADMIN';
    signing_public_key: PublicKeyJwk | null;
    signing_key_algorithm: SigningKeyAlgorithm | null;
    signing_key_status: SigningKeyStatus;
    signing_key_registered_at: string | null;
    signing_key_rotated_at: string | null;
}

export interface SigningIdentityDTO {
    algorithm: SigningKeyAlgorithm | null;
    status: SigningKeyStatus;
    registeredAt: string | null;
    rotatedAt: string | null;
    fingerprint: string | null;
}

interface RequestStateRow {
    id: number;
    client_id: number;
    driver_id: number | null;
    status: string;
    handshake_code: string | null;
    locker_id: number | null;
    locker_code: string | null;
    locker_code_expires_at: string | null;
}

export interface ChallengeSignerSpec {
    actorId: number;
    role: Extract<CustodyRole, 'CLIENT' | 'DRIVER'>;
}

interface ChallengePayload {
    challengeId: string;
    requestId: number;
    eventType: CriticalCustodyEventType;
    previousBlockHash: string | null;
    actorId: number;
    counterpartyId: number | null;
    timestamp: string;
    nonce: string;
    payloadDigest: string;
}

export interface CustodyChallengeDTO {
    id: string;
    requestId: number;
    eventType: CriticalCustodyEventType;
    canonicalMessage: string;
    challengeHash: string;
    previousBlockHash: string | null;
    payloadDigest: string;
    requiredSigners: ChallengeSignerSpec[];
    signatures: CustodyActorSignature[];
    status: CustodyChallengeStatus;
    expiresAt: string | null;
    createdAt: string;
}

interface CustodyChallengeRow {
    id: string;
    request_id: number;
    event_type: CriticalCustodyEventType;
    challenge_payload: ChallengePayload | string;
    canonical_message: string;
    challenge_hash: string;
    previous_block_hash: string | null;
    payload_digest: string;
    required_signers: ChallengeSignerSpec[] | string;
    signatures: CustodyActorSignature[] | string;
    status: CustodyChallengeStatus;
    expires_at: string | null;
    committed_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface CustodyActorSignature {
    actorId: number;
    role: Extract<CustodyRole, 'CLIENT' | 'DRIVER'>;
    algorithm: SigningKeyAlgorithm;
    publicKeyJwk: PublicKeyJwk;
    fingerprint: string;
    signature: string;
    signedAt: string;
}

interface CustodySystemAttestation {
    actorId: 0;
    role: 'LOCKER_SYSTEM';
    algorithm: 'HMAC_SHA256';
    signature: string;
    signedAt: string;
    metadata: Record<string, unknown>;
}

interface ValidatorVote {
    validatorId: string;
    committedAt: string;
    signature: string;
}

export interface CustodyBlock {
    proposalId: string;
    requestId: number;
    eventType: CriticalCustodyEventType;
    blockHeight: number;
    previousBlockHash: string | null;
    payloadDigest: string;
    challengeHash: string;
    canonicalMessage: string;
    actorSignatures: CustodyActorSignature[];
    systemAttestations: CustodySystemAttestation[];
    validatorCommitCertificate: ValidatorVote[];
    blockHash: string;
    createdAt: string;
}

export interface CustodyLedgerVerification {
    requestId: number;
    verified: boolean;
    storageMode: 'PERMISSIONED_CUSTODY_LEDGER';
    blockCount: number;
    lastBlockHash: string | null;
    issues: string[];
}

export interface CustodyProofDTO {
    requestId: number;
    storageMode: 'PERMISSIONED_CUSTODY_LEDGER';
    blocks: CustodyBlock[];
    verification: CustodyLedgerVerification;
}

export interface CustodySummary {
    storageMode: 'PERMISSIONED_CUSTODY_LEDGER';
    blockHash: string;
    previousBlockHash: string | null;
    ledgerHeight: number;
    quorumProof: ValidatorVote[];
}

const VALIDATOR_IDS = ['ledger-a', 'ledger-b', 'ledger-c'] as const;
const LEDGER_BASE_DIR = process.env.CUSTODY_LEDGER_BASE_DIR
    || path.join(os.tmpdir(), `city2cruise-ledger-${config.env}`);

function stableSort(value: unknown): unknown {
    if (value && typeof (value as any).toJSON === 'function') {
        return stableSort((value as any).toJSON());
    }
    if (Array.isArray(value)) return value.map(stableSort);
    if (value && typeof value === 'object') {
        return Object.keys(value as Record<string, unknown>)
            .sort()
            .reduce<Record<string, unknown>>((acc, key) => {
                acc[key] = stableSort((value as Record<string, unknown>)[key]);
                return acc;
            }, {});
    }
    return value;
}

function stableStringify(value: unknown): string {
    return JSON.stringify(stableSort(value));
}

function sha256(payload: string): string {
    return crypto.createHash('sha256').update(payload).digest('hex');
}

function hmac(secret: string, payload: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function parseJson<T>(value: T | string | null): T | null {
    if (value == null) return null;
    if (typeof value === 'string') {
        return JSON.parse(value) as T;
    }
    return value as T;
}

function publicKeyFingerprint(publicKeyJwk: PublicKeyJwk): string {
    return sha256(stableStringify(publicKeyJwk));
}

function getValidatorSecret(validatorId: string): string {
    return `${config.auditHmacSecret}:${validatorId}`;
}

function validatorVoteSignature(validatorId: string, blockHash: string, committedAt: string): string {
    return hmac(getValidatorSecret(validatorId), `${validatorId}:${blockHash}:${committedAt}`);
}

function systemAttestationSignature(
    eventType: CriticalCustodyEventType,
    requestId: number,
    payloadDigest: string,
    signedAt: string,
    metadata: Record<string, unknown>,
): string {
    return hmac(config.auditHmacSecret, stableStringify({
        eventType,
        requestId,
        payloadDigest,
        signedAt,
        metadata,
    }));
}

function verifyUserSignature(publicKeyJwk: PublicKeyJwk, canonicalMessage: string, signature: string): boolean {
    try {
        const key = crypto.createPublicKey({ key: publicKeyJwk, format: 'jwk' });
        return crypto.verify(
            'sha256',
            Buffer.from(canonicalMessage, 'utf8'),
            { key, dsaEncoding: 'ieee-p1363' },
            Buffer.from(signature, 'base64url'),
        );
    } catch {
        return false;
    }
}

function ensureEcdsaP256Jwk(value: unknown): PublicKeyJwk {
    if (!value || typeof value !== 'object') {
        throw new ServiceError(400, 'BAD_REQUEST', 'Clave pública inválida');
    }
    const jwk = value as Record<string, unknown>;
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') {
        throw new ServiceError(400, 'BAD_REQUEST', 'La clave pública debe ser EC P-256');
    }
    return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}

function buildCanonicalMessage(payload: ChallengePayload): string {
    return stableStringify(payload);
}

async function ensureLedgerDirs(): Promise<void> {
    await fs.mkdir(LEDGER_BASE_DIR, { recursive: true });
    await Promise.all(VALIDATOR_IDS.map(async (validatorId) => {
        await fs.mkdir(path.join(LEDGER_BASE_DIR, validatorId, 'pending'), { recursive: true });
        const ledgerPath = path.join(LEDGER_BASE_DIR, validatorId, 'ledger.json');
        try {
            await fs.access(ledgerPath);
        } catch {
            await fs.writeFile(ledgerPath, JSON.stringify({ validatorId, blocks: [] }, null, 2), 'utf8');
        }
    }));
}

async function readLedger(validatorId: string): Promise<{ validatorId: string; blocks: CustodyBlock[] }> {
    if (USE_HTTP_VALIDATORS) {
        const res = await validatorFetch(validatorId, '/ledger');
        if (!res.ok) throw new ServiceError(503, 'VALIDATOR_UNAVAILABLE', `Validator ${validatorId} unavailable (${res.status})`);
        return res.json() as Promise<{ validatorId: string; blocks: CustodyBlock[] }>;
    }
    await ensureLedgerDirs();
    const ledgerPath = path.join(LEDGER_BASE_DIR, validatorId, 'ledger.json');
    const raw = await fs.readFile(ledgerPath, 'utf8');
    return JSON.parse(raw) as { validatorId: string; blocks: CustodyBlock[] };
}

async function writeLedger(validatorId: string, ledger: { validatorId: string; blocks: CustodyBlock[] }): Promise<void> {
    // Only used in embedded mode — HTTP mode validators write their own ledger.
    const ledgerPath = path.join(LEDGER_BASE_DIR, validatorId, 'ledger.json');
    await fs.writeFile(ledgerPath, JSON.stringify(ledger, null, 2), 'utf8');
}

function latestBlockForRequest(blocks: CustodyBlock[], requestId: number): CustodyBlock | null {
    const requestBlocks = blocks.filter((block) => block.requestId === requestId);
    return requestBlocks.length > 0 ? requestBlocks[requestBlocks.length - 1] : null;
}

function buildBlockHash(block: Omit<CustodyBlock, 'blockHash' | 'validatorCommitCertificate'>): string {
    return sha256(stableStringify(block));
}

function parseChallengeRow(row: CustodyChallengeRow): CustodyChallengeDTO {
    return {
        id: row.id,
        requestId: row.request_id,
        eventType: row.event_type,
        canonicalMessage: row.canonical_message,
        challengeHash: row.challenge_hash,
        previousBlockHash: row.previous_block_hash,
        payloadDigest: row.payload_digest,
        requiredSigners: parseJson<ChallengeSignerSpec[]>(row.required_signers) || [],
        signatures: parseJson<CustodyActorSignature[]>(row.signatures) || [],
        status: row.status,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
    };
}

async function getRequestState(requestId: number): Promise<RequestStateRow> {
    const { rows: [row] } = await db.query<RequestStateRow>(
        `SELECT id, client_id, driver_id, status, handshake_code, locker_id, locker_code, locker_code_expires_at
         FROM pickup_requests WHERE id = $1`,
        [requestId],
    );
    if (!row) {
        throw new ServiceError(404, 'NOT_FOUND', 'Pedido no encontrado');
    }
    return row;
}

async function assertRequestAccess(requestId: number, actorId: number, actorRole: 'CLIENT' | 'DRIVER' | 'ADMIN'): Promise<RequestStateRow> {
    const request = await getRequestState(requestId);
    const authorized = actorRole === 'ADMIN'
        || request.client_id === actorId
        || request.driver_id === actorId;
    if (!authorized) {
        throw new ServiceError(403, 'FORBIDDEN', 'No autorizado para acceder a la custodia de esta solicitud');
    }
    return request;
}

async function getUserSigningKey(userId: number): Promise<UserSigningKeyRow> {
    const { rows: [row] } = await db.query<UserSigningKeyRow>(
        `SELECT id, role, signing_public_key, signing_key_algorithm, signing_key_status,
                signing_key_registered_at, signing_key_rotated_at
         FROM users WHERE id = $1`,
        [userId],
    );
    if (!row) throw new ServiceError(404, 'NOT_FOUND', 'Usuario no encontrado');
    return row;
}

async function getLatestCommittedBlock(requestId: number): Promise<CustodyBlock | null> {
    const ledgers = await Promise.all(VALIDATOR_IDS.map((validatorId) => readLedger(validatorId)));
    const candidates = ledgers
        .map((ledger) => latestBlockForRequest(ledger.blocks, requestId))
        .filter((block): block is CustodyBlock => !!block);
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.blockHeight - b.blockHeight);
    return candidates[candidates.length - 1];
}

function buildPayloadDigest(
    eventType: CriticalCustodyEventType,
    request: RequestStateRow,
    eventPayload: Record<string, unknown>,
): string {
    return sha256(stableStringify({
        eventType,
        requestId: request.id,
        clientId: request.client_id,
        driverId: request.driver_id,
        handshakeCodeFingerprint: request.handshake_code ? sha256(request.handshake_code) : null,
        lockerId: request.locker_id,
        lockerCodeFingerprint: request.locker_code ? sha256(request.locker_code) : null,
        lockerCodeExpiresAt: request.locker_code_expires_at,
        eventPayload,
    }));
}

function requiredSignersForRequest(request: RequestStateRow, eventType: CriticalCustodyEventType): ChallengeSignerSpec[] {
    if (!request.driver_id) {
        throw new ServiceError(409, 'CONFLICT', 'El pedido no tiene conductor asignado');
    }
    if (eventType === 'HANDSHAKE_VALIDATED') {
        return [
            { actorId: request.client_id, role: 'CLIENT' },
            { actorId: request.driver_id, role: 'DRIVER' },
        ];
    }
    if (eventType === 'DEPOSITED') {
        return [{ actorId: request.driver_id, role: 'DRIVER' }];
    }
    return [{ actorId: request.client_id, role: 'CLIENT' }];
}

function validateEventTransition(request: RequestStateRow, eventType: CriticalCustodyEventType): void {
    if (eventType === 'HANDSHAKE_VALIDATED' && !['CONFIRMATION_PENDING', 'IN_PROGRESS'].includes(request.status)) {
        throw new ServiceError(409, 'CONFLICT', 'El pedido no está listo para handshake');
    }
    if (eventType === 'DEPOSITED' && !['IN_PROGRESS', 'DEPOSITED'].includes(request.status)) {
        throw new ServiceError(409, 'CONFLICT', 'El pedido no está listo para depósito');
    }
    if (eventType === 'PICKED_UP' && !['DEPOSITED', 'PICKED_UP'].includes(request.status)) {
        throw new ServiceError(409, 'CONFLICT', 'El pedido no está listo para recogida');
    }
}

function validateLedgerContract(
    eventType: CriticalCustodyEventType,
    previousBlock: CustodyBlock | null,
    actorSignatures: CustodyActorSignature[],
): void {
    const signerRoles = new Set(actorSignatures.map((sig) => sig.role));
    if (eventType === 'HANDSHAKE_VALIDATED') {
        if (!signerRoles.has('CLIENT') || !signerRoles.has('DRIVER')) {
            throw new ServiceError(409, 'MISSING_SIGNATURES', 'El handshake requiere firma de cliente y conductor');
        }
        if (previousBlock && previousBlock.eventType !== 'PICKED_UP') {
            throw new ServiceError(409, 'CHAIN_ORDER_INVALID', 'La cadena previa impide un nuevo handshake');
        }
    }
    if (eventType === 'DEPOSITED') {
        if (!signerRoles.has('DRIVER')) {
            throw new ServiceError(409, 'MISSING_SIGNATURES', 'El depósito requiere firma del conductor');
        }
        if (!previousBlock || previousBlock.eventType !== 'HANDSHAKE_VALIDATED') {
            throw new ServiceError(409, 'CHAIN_ORDER_INVALID', 'El depósito requiere handshake confirmado previo');
        }
    }
    if (eventType === 'PICKED_UP') {
        if (!signerRoles.has('CLIENT')) {
            throw new ServiceError(409, 'MISSING_SIGNATURES', 'La recogida requiere firma del cliente');
        }
        if (!previousBlock || previousBlock.eventType !== 'DEPOSITED') {
            throw new ServiceError(409, 'CHAIN_ORDER_INVALID', 'La recogida requiere depósito previo');
        }
    }
}

export async function getSigningIdentity(userId: number): Promise<SigningIdentityDTO> {
    const row = await getUserSigningKey(userId);
    const publicKey = row.signing_public_key ? ensureEcdsaP256Jwk(row.signing_public_key) : null;
    return {
        algorithm: row.signing_key_algorithm,
        status: row.signing_key_status,
        registeredAt: row.signing_key_registered_at,
        rotatedAt: row.signing_key_rotated_at,
        fingerprint: publicKey ? publicKeyFingerprint(publicKey) : null,
    };
}

export async function registerOrRotateSigningKey(params: {
    userId: number;
    publicKeyJwk: unknown;
    algorithm: SigningKeyAlgorithm;
    rotate?: boolean;
}): Promise<SigningIdentityDTO> {
    const publicKeyJwk = ensureEcdsaP256Jwk(params.publicKeyJwk);
    const now = new Date().toISOString();
    await db.query(
        `UPDATE users
         SET signing_public_key = $1,
             signing_key_algorithm = $2,
             signing_key_status = 'ACTIVE',
             signing_key_registered_at = COALESCE(signing_key_registered_at, $3),
             signing_key_rotated_at = CASE WHEN $4::boolean THEN $3 ELSE signing_key_rotated_at END
         WHERE id = $5`,
        [JSON.stringify(publicKeyJwk), params.algorithm, now, params.rotate === true, params.userId],
    );
    return getSigningIdentity(params.userId);
}

export async function getOrCreateCustodyChallenge(params: {
    requestId: number;
    eventType: CriticalCustodyEventType;
    requesterId: number;
    requesterRole: 'CLIENT' | 'DRIVER' | 'ADMIN';
    eventPayload: Record<string, unknown>;
}): Promise<CustodyChallengeDTO> {
    const request = await getRequestState(params.requestId);
    const authorized = params.requesterRole === 'ADMIN'
        || request.client_id === params.requesterId
        || request.driver_id === params.requesterId;
    if (!authorized) {
        throw new ServiceError(403, 'FORBIDDEN', 'No autorizado para crear un challenge de esta solicitud');
    }
    validateEventTransition(request, params.eventType);

    const { rows: [existing] } = await db.query<CustodyChallengeRow>(
        `SELECT * FROM custody_challenges
         WHERE request_id = $1 AND event_type = $2 AND status = 'PENDING'
         ORDER BY created_at DESC
         LIMIT 1`,
        [params.requestId, params.eventType],
    );
    if (existing) {
        if (existing.expires_at && new Date(existing.expires_at) < new Date()) {
            await db.query(
                `UPDATE custody_challenges SET status = 'EXPIRED', updated_at = $1 WHERE id = $2`,
                [new Date().toISOString(), existing.id],
            );
        } else {
            return parseChallengeRow(existing);
        }
    }

    const previousBlock = await getLatestCommittedBlock(params.requestId);
    const id = createId();
    const now = new Date().toISOString();
    const payloadDigest = buildPayloadDigest(params.eventType, request, params.eventPayload);
    const payload: ChallengePayload = {
        challengeId: id,
        requestId: params.requestId,
        eventType: params.eventType,
        previousBlockHash: previousBlock?.blockHash || null,
        actorId: request.client_id,
        counterpartyId: request.driver_id,
        timestamp: now,
        nonce: crypto.randomUUID(),
        payloadDigest,
    };
    const canonicalMessage = buildCanonicalMessage(payload);
    const challengeHash = sha256(canonicalMessage);
    const requiredSigners = requiredSignersForRequest(request, params.eventType);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { rows: [created] } = await db.query<CustodyChallengeRow>(
        `INSERT INTO custody_challenges (
            id, request_id, event_type, challenge_payload, canonical_message, challenge_hash,
            previous_block_hash, payload_digest, required_signers, signatures, status, expires_at, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '[]'::jsonb, 'PENDING', $10, $11, $12)
         RETURNING *`,
        [
            id,
            params.requestId,
            params.eventType,
            JSON.stringify(payload),
            canonicalMessage,
            challengeHash,
            previousBlock?.blockHash || null,
            payloadDigest,
            JSON.stringify(requiredSigners),
            expiresAt,
            now,
            now,
        ],
    );

    return parseChallengeRow(created);
}

export async function getCustodyChallenge(challengeId: string): Promise<CustodyChallengeDTO> {
    const { rows: [row] } = await db.query<CustodyChallengeRow>('SELECT * FROM custody_challenges WHERE id = $1', [challengeId]);
    if (!row) throw new ServiceError(404, 'NOT_FOUND', 'Challenge no encontrado');
    return parseChallengeRow(row);
}

export async function getCustodyChallengeForActor(params: {
    challengeId: string;
    actorId: number;
    actorRole: 'CLIENT' | 'DRIVER' | 'ADMIN';
}): Promise<CustodyChallengeDTO> {
    const challenge = await getCustodyChallenge(params.challengeId);
    await assertRequestAccess(challenge.requestId, params.actorId, params.actorRole);
    return challenge;
}

export async function signCustodyChallenge(params: {
    challengeId: string;
    actorId: number;
    signature: string;
}): Promise<CustodyChallengeDTO> {
    const { rows: [row] } = await db.query<CustodyChallengeRow>('SELECT * FROM custody_challenges WHERE id = $1', [params.challengeId]);
    if (!row) throw new ServiceError(404, 'NOT_FOUND', 'Challenge no encontrado');
    if (row.status !== 'PENDING') {
        throw new ServiceError(409, 'CONFLICT', 'El challenge ya no está disponible para firma');
    }
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
        await db.query(`UPDATE custody_challenges SET status = 'EXPIRED', updated_at = $1 WHERE id = $2`, [new Date().toISOString(), row.id]);
        throw new ServiceError(410, 'GONE', 'El challenge ha expirado');
    }

    const challenge = parseChallengeRow(row);
    const signerSpec = challenge.requiredSigners.find((signer) => signer.actorId === params.actorId);
    if (!signerSpec) {
        throw new ServiceError(403, 'FORBIDDEN', 'No estás autorizado para firmar este challenge');
    }

    const signingKey = await getUserSigningKey(params.actorId);
    if (signingKey.signing_key_status !== 'ACTIVE' || !signingKey.signing_public_key || !signingKey.signing_key_algorithm) {
        throw new ServiceError(409, 'SIGNING_KEY_REQUIRED', 'Debes registrar una clave criptográfica activa');
    }

    const publicKeyJwk = ensureEcdsaP256Jwk(signingKey.signing_public_key);
    if (!verifyUserSignature(publicKeyJwk, challenge.canonicalMessage, params.signature)) {
        throw new ServiceError(400, 'INVALID_SIGNATURE', 'La firma no es válida para este challenge');
    }

    const signatureRecord: CustodyActorSignature = {
        actorId: params.actorId,
        role: signerSpec.role,
        algorithm: signingKey.signing_key_algorithm,
        publicKeyJwk,
        fingerprint: publicKeyFingerprint(publicKeyJwk),
        signature: params.signature,
        signedAt: new Date().toISOString(),
    };

    const nextSignatures = challenge.signatures.filter((signature) => signature.actorId !== params.actorId);
    nextSignatures.push(signatureRecord);

    const { rows: [updated] } = await db.query<CustodyChallengeRow>(
        `UPDATE custody_challenges
         SET signatures = $1, updated_at = $2
         WHERE id = $3
         RETURNING *`,
        [JSON.stringify(nextSignatures), new Date().toISOString(), params.challengeId],
    );

    return parseChallengeRow(updated);
}

async function buildPreparedBlock(params: {
    challengeId: string;
    eventType: CriticalCustodyEventType;
    systemAttestationMetadata: Record<string, unknown>[];
}): Promise<{ proposalId: string; block: CustodyBlock }> {
    const challenge = await getCustodyChallenge(params.challengeId);
    if (challenge.eventType !== params.eventType) {
        throw new ServiceError(409, 'CONFLICT', 'El challenge no corresponde al evento solicitado');
    }
    const request = await getRequestState(challenge.requestId);
    validateEventTransition(request, params.eventType);

    const signatureActorIds = new Set(challenge.signatures.map((signature) => signature.actorId));
    for (const signer of challenge.requiredSigners) {
        if (!signatureActorIds.has(signer.actorId)) {
            throw new ServiceError(409, 'MISSING_SIGNATURES', 'Faltan firmas requeridas para confirmar la custodia');
        }
    }

    const previousBlock = await getLatestCommittedBlock(challenge.requestId);
    validateLedgerContract(params.eventType, previousBlock, challenge.signatures);

    const createdAt = new Date().toISOString();
    const systemAttestations = params.systemAttestationMetadata.map((metadata): CustodySystemAttestation => ({
        actorId: 0,
        role: 'LOCKER_SYSTEM',
        algorithm: 'HMAC_SHA256',
        signedAt: createdAt,
        metadata,
        signature: systemAttestationSignature(params.eventType, challenge.requestId, challenge.payloadDigest, createdAt, metadata),
    }));

    const proposalId = createId();
    const provisionalBlock = {
        proposalId,
        requestId: challenge.requestId,
        eventType: params.eventType,
        blockHeight: (previousBlock?.blockHeight || 0) + 1,
        previousBlockHash: previousBlock?.blockHash || null,
        payloadDigest: challenge.payloadDigest,
        challengeHash: challenge.challengeHash,
        canonicalMessage: challenge.canonicalMessage,
        actorSignatures: challenge.signatures,
        systemAttestations,
        createdAt,
    };
    const blockHash = buildBlockHash(provisionalBlock);

    logger.debug({ proposalId, blockHash, blockInput: stableStringify(provisionalBlock) }, 'Hash calculated for proposal');

    return {
        proposalId,
        block: {
            ...provisionalBlock,
            validatorCommitCertificate: [],
            blockHash,
        },
    };
}

export async function prepareCustodyCommit(params: {
    challengeId: string;
    eventType: CriticalCustodyEventType;
    systemAttestationMetadata?: Record<string, unknown>[];
}): Promise<{ proposalId: string; block: CustodyBlock }> {
    const prepared = await buildPreparedBlock({
        challengeId: params.challengeId,
        eventType: params.eventType,
        systemAttestationMetadata: params.systemAttestationMetadata || [],
    });

    if (USE_HTTP_VALIDATORS) {
        await Promise.all(VALIDATOR_IDS.map(async (validatorId) => {
            const res = await validatorFetch(validatorId, `/pending/${prepared.proposalId}`, {
                method: 'PUT',
                body: JSON.stringify(prepared.block),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                const message = body.error || `HTTP ${res.status}`;
                throw new ServiceError(503, 'VALIDATOR_UNAVAILABLE', `Validator ${validatorId} rejected proposal: ${message}`);
            }
        }));
    } else {
        await ensureLedgerDirs();
        await Promise.all(VALIDATOR_IDS.map(async (validatorId) => {
            const pendingPath = path.join(LEDGER_BASE_DIR, validatorId, 'pending', `${prepared.proposalId}.json`);
            await fs.writeFile(pendingPath, JSON.stringify(prepared.block, null, 2), 'utf8');
        }));
    }

    return prepared;
}

export async function finalizeCustodyCommit(proposalId: string): Promise<void> {
    let successCount = 0;
    const committedValidators: string[] = [];
    const committedVotes: ValidatorVote[] = [];

    if (USE_HTTP_VALIDATORS) {
        for (const validatorId of VALIDATOR_IDS) {
            try {
                const res = await validatorFetch(validatorId, `/commit/${proposalId}`, { method: 'POST' });
                if (res.ok) {
                    const body = await res.json() as { vote?: ValidatorVote };
                    if (!body.vote || body.vote.validatorId !== validatorId) {
                        throw new Error(`validator ${validatorId} did not return a valid vote`);
                    }
                    successCount += 1;
                    committedValidators.push(validatorId);
                    committedVotes.push(body.vote);
                } else {
                    const body = await res.json().catch(() => ({}));
                    logger.warn({ validatorId, status: res.status, error: body.error }, 'Validator rejected commit');
                }
            } catch (err) {
                logger.error({ validatorId, err: (err as Error).message }, 'Error calling validator commit');
            }
        }

        if (successCount < 2) {
            await Promise.all(committedValidators.map((validatorId) =>
                validatorFetch(validatorId, `/committed/${proposalId}`, { method: 'DELETE' }).catch(() => {}),
            ));
            throw new ServiceError(503, 'LEDGER_QUORUM_FAILED', 'No se pudo confirmar el bloque en el quórum del ledger');
        }

        await Promise.all(committedValidators.map((validatorId) =>
            validatorFetch(validatorId, `/committed/${proposalId}/certificate`, {
                method: 'PUT',
                body: JSON.stringify({ validatorCommitCertificate: committedVotes }),
            }).catch(() => {})
        ));
    } else {
        await ensureLedgerDirs();
        for (const validatorId of VALIDATOR_IDS) {
            const pendingPath = path.join(LEDGER_BASE_DIR, validatorId, 'pending', `${proposalId}.json`);
            try {
                const raw = await fs.readFile(pendingPath, 'utf8');
                const block = JSON.parse(raw) as CustodyBlock;
                const ledger = await readLedger(validatorId);
                const previous = latestBlockForRequest(ledger.blocks, block.requestId);
                if ((previous?.blockHash || null) !== block.previousBlockHash) {
                    throw new Error('previous_block_hash mismatch');
                }
                if ((previous?.blockHeight || 0) + 1 !== block.blockHeight) {
                    throw new Error('block height mismatch');
                }
                const committedAt = new Date().toISOString();
                const vote: ValidatorVote = {
                    validatorId,
                    committedAt,
                    signature: validatorVoteSignature(validatorId, block.blockHash, committedAt),
                };
                ledger.blocks.push({
                    ...block,
                    validatorCommitCertificate: [vote],
                });
                await writeLedger(validatorId, ledger);
                await fs.unlink(pendingPath);
                successCount += 1;
                committedValidators.push(validatorId);
                committedVotes.push(vote);
            } catch {
                // no-op: el quórum se valida al final
            }
        }

        if (successCount < 2) {
            await Promise.all(committedValidators.map(async (validatorId) => {
                const ledger = await readLedger(validatorId);
                const nextBlocks = ledger.blocks.filter((block) => block.proposalId !== proposalId);
                if (nextBlocks.length !== ledger.blocks.length) {
                    await writeLedger(validatorId, { ...ledger, blocks: nextBlocks });
                }
            }));
            throw new ServiceError(503, 'LEDGER_QUORUM_FAILED', 'No se pudo confirmar el bloque en el quórum del ledger');
        }

        await Promise.all(committedValidators.map(async (validatorId) => {
            const ledger = await readLedger(validatorId);
            const block = ledger.blocks.find((entry) => entry.proposalId === proposalId);
            if (block) {
                block.validatorCommitCertificate = committedVotes;
                await writeLedger(validatorId, ledger);
            }
        }));
    }
}

export async function abortCustodyCommit(proposalId: string): Promise<void> {
    if (USE_HTTP_VALIDATORS) {
        await Promise.all(VALIDATOR_IDS.map((validatorId) =>
            validatorFetch(validatorId, `/pending/${proposalId}`, { method: 'DELETE' }).catch(() => {}),
        ));
    } else {
        await Promise.all(VALIDATOR_IDS.map(async (validatorId) => {
            const pendingPath = path.join(LEDGER_BASE_DIR, validatorId, 'pending', `${proposalId}.json`);
            try {
                await fs.unlink(pendingPath);
            } catch {
                // ignore missing files
            }
        }));
    }
}

export async function markChallengeCommitted(challengeId: string): Promise<void> {
    await db.query(
        `UPDATE custody_challenges
         SET status = 'COMMITTED', committed_at = $1, updated_at = $1
         WHERE id = $2`,
        [new Date().toISOString(), challengeId],
    );
}

export async function getRequestCustodyProof(requestId: number): Promise<CustodyProofDTO> {
    const ledgers = await Promise.all(VALIDATOR_IDS.map((validatorId) => readLedger(validatorId)));
    const reference = ledgers[0].blocks.filter((block) => block.requestId === requestId);
    const verification = await verifyRequestCustodyProof(requestId);
    return {
        requestId,
        storageMode: 'PERMISSIONED_CUSTODY_LEDGER',
        blocks: reference,
        verification,
    };
}

export async function verifyRequestCustodyProof(requestId: number): Promise<CustodyLedgerVerification> {
    const ledgers = await Promise.all(VALIDATOR_IDS.map((validatorId) => readLedger(validatorId)));
    const issues: string[] = [];
    const chains = ledgers.map((ledger) => ({
        validatorId: ledger.validatorId,
        blocks: ledger.blocks.filter((block) => block.requestId === requestId),
    }));
    const chainBuckets = new Map<string, { validatorIds: string[]; blocks: CustodyBlock[] }>();
    for (const chain of chains) {
        const fingerprint = stableStringify(chain.blocks);
        const bucket = chainBuckets.get(fingerprint);
        if (bucket) {
            bucket.validatorIds.push(chain.validatorId);
        } else {
            chainBuckets.set(fingerprint, { validatorIds: [chain.validatorId], blocks: chain.blocks });
        }
    }

    const winningChain = [...chainBuckets.values()].sort((a, b) => b.validatorIds.length - a.validatorIds.length)[0]
        || { validatorIds: [], blocks: [] as CustodyBlock[] };
    const blocks = winningChain.blocks;
    if (winningChain.validatorIds.length < 2 && chains.some((chain) => chain.blocks.length > 0)) {
        issues.push('No existe quórum entre validadores para la cadena de custodia');
    }
    for (const chain of chains) {
        if (stableStringify(chain.blocks) !== stableStringify(blocks)) {
            issues.push(`Divergencia detectada en ${chain.validatorId}`);
        }
    }
    let previousBlockHash: string | null = null;

    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const expectedHash = buildBlockHash({
            proposalId: block.proposalId,
            requestId: block.requestId,
            eventType: block.eventType,
            blockHeight: block.blockHeight,
            previousBlockHash: block.previousBlockHash,
            payloadDigest: block.payloadDigest,
            challengeHash: block.challengeHash,
            canonicalMessage: block.canonicalMessage,
            actorSignatures: block.actorSignatures,
            systemAttestations: block.systemAttestations,
            createdAt: block.createdAt,
        });
        if (block.blockHeight !== i + 1) {
            issues.push(`Bloque ${block.proposalId}: altura inválida`);
        }
        if (block.previousBlockHash !== previousBlockHash) {
            issues.push(`Bloque ${block.proposalId}: previous_block_hash inválido`);
        }
        if (block.blockHash !== expectedHash) {
            issues.push(`Bloque ${block.proposalId}: block_hash inválido`);
        }
        for (const signature of block.actorSignatures) {
            if (!verifyUserSignature(signature.publicKeyJwk, block.canonicalMessage, signature.signature)) {
                issues.push(`Bloque ${block.proposalId}: firma humana inválida para actor ${signature.actorId}`);
            }
        }
        for (const attestation of block.systemAttestations) {
            const expected = systemAttestationSignature(
                block.eventType,
                block.requestId,
                block.payloadDigest,
                attestation.signedAt,
                attestation.metadata,
            );
            if (expected !== attestation.signature) {
                issues.push(`Bloque ${block.proposalId}: atestación de sistema inválida`);
            }
        }
        for (const vote of block.validatorCommitCertificate) {
            const expected = validatorVoteSignature(vote.validatorId, block.blockHash, vote.committedAt);
            if (expected !== vote.signature) {
                issues.push(`Bloque ${block.proposalId}: voto inválido de ${vote.validatorId}`);
            }
        }
        if (block.validatorCommitCertificate.length < 2) {
            issues.push(`Bloque ${block.proposalId}: quórum insuficiente`);
        }
        previousBlockHash = block.blockHash;
    }

    return {
        requestId,
        verified: issues.length === 0,
        storageMode: 'PERMISSIONED_CUSTODY_LEDGER',
        blockCount: blocks.length,
        lastBlockHash: blocks.at(-1)?.blockHash || null,
        issues,
    };
}

export async function getLatestCustodySummary(requestId: number): Promise<CustodySummary | null> {
    const latest = await getLatestCommittedBlock(requestId);
    if (!latest) return null;
    return {
        storageMode: 'PERMISSIONED_CUSTODY_LEDGER',
        blockHash: latest.blockHash,
        previousBlockHash: latest.previousBlockHash,
        ledgerHeight: latest.blockHeight,
        quorumProof: latest.validatorCommitCertificate,
    };
}

export interface ValidatorHealthEntry {
    validatorId: string;
    status: 'ok' | 'error' | 'unreachable';
    blockCount?: number;
    error?: string;
    mode: 'http' | 'embedded';
}

export async function getQuorumHealth(): Promise<ValidatorHealthEntry[]> {
    if (USE_HTTP_VALIDATORS) {
        return Promise.all(VALIDATOR_IDS.map(async (validatorId): Promise<ValidatorHealthEntry> => {
            try {
                const res = await validatorFetch(validatorId, '/health');
                if (!res.ok) {
                    return { validatorId, status: 'error', error: `HTTP ${res.status}`, mode: 'http' };
                }
                const body = await res.json() as { status?: string; blockCount?: number };
                return {
                    validatorId,
                    status: body.status === 'ok' ? 'ok' : 'error',
                    blockCount: body.blockCount,
                    mode: 'http',
                };
            } catch (err) {
                return {
                    validatorId,
                    status: 'unreachable',
                    error: err instanceof Error ? err.message : String(err),
                    mode: 'http',
                };
            }
        }));
    }

    // Embedded mode: check ledger files
    return Promise.all(VALIDATOR_IDS.map(async (validatorId): Promise<ValidatorHealthEntry> => {
        try {
            const ledger = await readLedger(validatorId);
            return { validatorId, status: 'ok', blockCount: ledger.blocks.length, mode: 'embedded' };
        } catch (err) {
            return {
                validatorId,
                status: 'error',
                error: err instanceof Error ? err.message : String(err),
                mode: 'embedded',
            };
        }
    }));
}

export async function resetCustodyLedgerForTests(): Promise<void> {
    if (USE_HTTP_VALIDATORS) {
        await Promise.all(VALIDATOR_IDS.map((validatorId) =>
            validatorFetch(validatorId, '/reset', { method: 'DELETE' }).catch(() => {}),
        ));
    } else {
        await fs.rm(LEDGER_BASE_DIR, { recursive: true, force: true });
    }
}

export const __test__ = {
    ledgerBaseDir: LEDGER_BASE_DIR,
    validatorIds: [...VALIDATOR_IDS],
};
