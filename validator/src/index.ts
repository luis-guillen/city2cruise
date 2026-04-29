import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const VALIDATOR_ID = process.env.VALIDATOR_ID ?? '';
if (!VALIDATOR_ID) {
    console.error('FATAL: VALIDATOR_ID is required');
    process.exit(1);
}

const PORT = parseInt(process.env.VALIDATOR_PORT || '4001', 10);
const AUDIT_HMAC_SECRET = process.env.AUDIT_HMAC_SECRET || 'audit_secret_dev';
const INTERNAL_KEY = process.env.VALIDATOR_INTERNAL_KEY || 'dev_validator_key';
const DATA_DIR = process.env.LEDGER_DATA_DIR || `/tmp/ledger-${VALIDATOR_ID}`;
const LEDGER_PATH = path.join(DATA_DIR, 'ledger.json');
const PENDING_DIR = path.join(DATA_DIR, 'pending');

interface ValidatorVote {
    validatorId: string;
    committedAt: string;
    signature: string;
}

interface CustodyBlock {
    proposalId: string;
    requestId: number;
    eventType: string;
    blockHeight: number;
    previousBlockHash: string | null;
    payloadDigest: string;
    challengeHash: string;
    canonicalMessage: string;
    actorSignatures: unknown[];
    systemAttestations: unknown[];
    validatorCommitCertificate: ValidatorVote[];
    blockHash: string;
    createdAt: string;
}

interface Ledger {
    validatorId: string;
    blocks: CustodyBlock[];
}

async function ensureDirs(): Promise<void> {
    await fs.mkdir(PENDING_DIR, { recursive: true });
    try {
        await fs.access(LEDGER_PATH);
    } catch {
        await fs.writeFile(
            LEDGER_PATH,
            JSON.stringify({ validatorId: VALIDATOR_ID, blocks: [] }, null, 2),
            'utf8',
        );
    }
}

async function readLedger(): Promise<Ledger> {
    await ensureDirs();
    const raw = await fs.readFile(LEDGER_PATH, 'utf8');
    return JSON.parse(raw) as Ledger;
}

async function writeLedger(ledger: Ledger): Promise<void> {
    await fs.writeFile(LEDGER_PATH, JSON.stringify(ledger, null, 2), 'utf8');
}

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

function sha256(payload: string): string {
    return crypto.createHash('sha256').update(payload).digest('hex');
}

function hmac(secret: string, payload: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function buildBlockHash(block: Omit<CustodyBlock, 'blockHash' | 'validatorCommitCertificate'>): string {
    return sha256(JSON.stringify(stableSort(block)));
}

function validatorVoteSignature(validatorId: string, blockHash: string, committedAt: string): string {
    return hmac(`${AUDIT_HMAC_SECRET}:${validatorId}`, `${validatorId}:${blockHash}:${committedAt}`);
}

function buildValidatorVote(blockHash: string): ValidatorVote {
    const validatorId = VALIDATOR_ID;
    const committedAt = new Date().toISOString();
    return {
        validatorId,
        committedAt,
        signature: validatorVoteSignature(validatorId, blockHash, committedAt),
    };
}

function validateVote(vote: ValidatorVote, blockHash: string): boolean {
    if (!vote || typeof vote.validatorId !== 'string' || typeof vote.committedAt !== 'string' || typeof vote.signature !== 'string') {
        return false;
    }
    return validatorVoteSignature(vote.validatorId, blockHash, vote.committedAt) === vote.signature;
}

function validatePendingBlock(block: CustodyBlock): string | null {
    if (!Number.isInteger(block.requestId) || block.requestId <= 0) return 'requestId inválido';
    if (typeof block.eventType !== 'string' || block.eventType.length === 0) return 'eventType inválido';
    if (!Number.isInteger(block.blockHeight) || block.blockHeight <= 0) return 'blockHeight inválido';
    if (block.previousBlockHash !== null && typeof block.previousBlockHash !== 'string') return 'previousBlockHash inválido';
    if (typeof block.payloadDigest !== 'string' || typeof block.challengeHash !== 'string' || typeof block.canonicalMessage !== 'string') {
        return 'payload de custodia inválido';
    }
    if (!Array.isArray(block.actorSignatures) || !Array.isArray(block.systemAttestations) || !Array.isArray(block.validatorCommitCertificate)) {
        return 'colecciones del bloque inválidas';
    }
    if (typeof block.createdAt !== 'string' || typeof block.blockHash !== 'string') return 'metadatos de bloque inválidos';

    const hashInput = {
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
    };
    const expectedHash = buildBlockHash(hashInput);

    if (block.blockHash !== expectedHash) {
        console.warn(`[${VALIDATOR_ID}] Hash mismatch for proposal ${block.proposalId}`);
        console.warn(`[${VALIDATOR_ID}]   - Received: ${block.blockHash}`);
        console.warn(`[${VALIDATOR_ID}]   - Expected: ${expectedHash}`);
        console.warn(`[${VALIDATOR_ID}]   - Hash Input (stable sorted): ${JSON.stringify(stableSort(hashInput))}`);
        return 'block_hash integrity check failed';
    }

    if (block.validatorCommitCertificate.some((vote) => !validateVote(vote, block.blockHash))) {
        console.warn(`[${VALIDATOR_ID}] Vote validation failed for proposal ${block.proposalId}`);
        return 'validator_commit_certificate inválido';
    }

    return null;
}

function latestForRequest(blocks: CustodyBlock[], requestId: number): CustodyBlock | null {
    const filtered = blocks.filter((b) => b.requestId === requestId);
    return filtered.length > 0 ? filtered[filtered.length - 1] : null;
}

const app = express();
app.use(express.json({ limit: '512kb' }));

function requireKey(req: Request, res: Response, next: NextFunction): void {
    if (req.headers['x-validator-key'] !== INTERNAL_KEY) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    next();
}

app.get('/health', (_req, res) => {
    readLedger()
        .then((ledger) => {
            res.json({
                validatorId: VALIDATOR_ID,
                status: 'ok',
                blockCount: ledger.blocks.length,
                dataDir: DATA_DIR,
            });
        })
        .catch((err: unknown) => {
            res.status(503).json({
                validatorId: VALIDATOR_ID,
                status: 'error',
                error: err instanceof Error ? err.message : String(err),
            });
        });
});

app.get('/ledger', requireKey, async (_req, res) => {
    const ledger = await readLedger();
    res.json(ledger);
});

app.get('/ledger/request/:requestId', requireKey, async (req, res) => {
    const requestId = parseInt(String(req.params.requestId), 10);
    const ledger = await readLedger();
    const blocks = ledger.blocks.filter((b) => b.requestId === requestId);
    res.json({ validatorId: VALIDATOR_ID, blocks });
});

app.get('/metrics', requireKey, async (_req, res) => {
    const ledger = await readLedger();
    const pendingFiles = await fs.readdir(PENDING_DIR).catch(() => [] as string[]);
    res.json({
        validatorId: VALIDATOR_ID,
        blockCount: ledger.blocks.length,
        pendingCount: pendingFiles.length,
        requestCount: new Set(ledger.blocks.map((b) => b.requestId)).size,
    });
});

// Store a pending block proposal
app.put('/pending/:proposalId', requireKey, async (req, res) => {
    await ensureDirs();
    const block = req.body as CustodyBlock;
    if (!block || typeof block !== 'object' || !block.proposalId) {
        res.status(400).json({ error: 'Invalid block payload' });
        return;
    }
    if (block.proposalId !== req.params.proposalId) {
        res.status(400).json({ error: 'proposalId mismatch' });
        return;
    }

    console.log(`[${VALIDATOR_ID}] Receiving proposal ${req.params.proposalId} for request ${block.requestId}`);

    const validationError = validatePendingBlock(block);
    if (validationError) {
        console.warn(`[${VALIDATOR_ID}] Proposal ${req.params.proposalId} REJECTED: ${validationError}`);
        res.status(400).json({ error: validationError });
        return;
    }
    const pendingPath = path.join(PENDING_DIR, `${req.params.proposalId}.json`);
    await fs.writeFile(pendingPath, JSON.stringify(block, null, 2), 'utf8');
    res.json({ proposalId: req.params.proposalId, stored: true });
});

// Commit a pending proposal to the ledger
app.post('/commit/:proposalId', requireKey, async (req, res) => {
    await ensureDirs();
    const pendingPath = path.join(PENDING_DIR, `${req.params.proposalId}.json`);
    let block: CustodyBlock;
    try {
        const raw = await fs.readFile(pendingPath, 'utf8');
        block = JSON.parse(raw) as CustodyBlock;
    } catch {
        res.status(404).json({ error: 'Pending proposal not found', committed: false });
        return;
    }

    const ledger = await readLedger();
    const previous = latestForRequest(ledger.blocks, block.requestId);

    if ((previous?.blockHash ?? null) !== block.previousBlockHash) {
        res.status(409).json({ error: 'previous_block_hash mismatch', committed: false });
        return;
    }
    if ((previous?.blockHeight ?? 0) + 1 !== block.blockHeight) {
        res.status(409).json({ error: 'block height mismatch', committed: false });
        return;
    }

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
    if (block.blockHash !== expectedHash) {
        res.status(409).json({ error: 'block_hash integrity check failed', committed: false });
        return;
    }

    const vote = buildValidatorVote(block.blockHash);
    const committedBlock: CustodyBlock = {
        ...block,
        validatorCommitCertificate: [vote],
    };
    ledger.blocks.push(committedBlock);
    await writeLedger(ledger);
    await fs.unlink(pendingPath);
    res.json({ proposalId: req.params.proposalId, committed: true, blockHeight: block.blockHeight, vote });
});

// Abort a pending proposal
app.delete('/pending/:proposalId', requireKey, async (req, res) => {
    const pendingPath = path.join(PENDING_DIR, `${req.params.proposalId}.json`);
    try {
        await fs.unlink(pendingPath);
    } catch {
        // ignore missing
    }
    res.json({ proposalId: req.params.proposalId, aborted: true });
});

// Rollback a committed block (used when quorum fails)
app.delete('/committed/:proposalId', requireKey, async (req, res) => {
    const ledger = await readLedger();
    const before = ledger.blocks.length;
    ledger.blocks = ledger.blocks.filter((b) => b.proposalId !== req.params.proposalId);
    if (ledger.blocks.length < before) {
        await writeLedger(ledger);
        res.json({ proposalId: req.params.proposalId, rolledBack: true });
    } else {
        res.status(404).json({ proposalId: req.params.proposalId, rolledBack: false, reason: 'not found' });
    }
});

app.put('/committed/:proposalId/certificate', requireKey, async (req, res) => {
    const certificate = req.body?.validatorCommitCertificate as ValidatorVote[] | undefined;
    if (!Array.isArray(certificate) || certificate.length < 2) {
        res.status(400).json({ error: 'validatorCommitCertificate inválido' });
        return;
    }

    const ledger = await readLedger();
    const block = ledger.blocks.find((entry) => entry.proposalId === req.params.proposalId);
    if (!block) {
        res.status(404).json({ error: 'Committed block not found' });
        return;
    }
    if (certificate.some((vote) => !validateVote(vote, block.blockHash))) {
        res.status(400).json({ error: 'validatorCommitCertificate inválido' });
        return;
    }

    block.validatorCommitCertificate = certificate;
    await writeLedger(ledger);
    res.json({ proposalId: req.params.proposalId, updated: true, certificateSize: certificate.length });
});

// Test/dev only: wipe ledger (only when NODE_ENV !== production)
app.delete('/reset', requireKey, async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        res.status(403).json({ error: 'Reset not allowed in production' });
        return;
    }
    await fs.rm(DATA_DIR, { recursive: true, force: true });
    res.json({ validatorId: VALIDATOR_ID, reset: true });
});

app.listen(PORT, () => {
    console.log(`[${VALIDATOR_ID}] Custody validator ready on :${PORT} (data: ${DATA_DIR})`);
});
