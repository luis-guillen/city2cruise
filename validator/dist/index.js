"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const crypto_1 = __importDefault(require("crypto"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const VALIDATOR_ID = process.env.VALIDATOR_ID ?? '';
if (!VALIDATOR_ID) {
    console.error('FATAL: VALIDATOR_ID is required');
    process.exit(1);
}
const PORT = parseInt(process.env.VALIDATOR_PORT || '4001', 10);
const AUDIT_HMAC_SECRET = process.env.AUDIT_HMAC_SECRET || 'audit_secret_dev';
const INTERNAL_KEY = process.env.VALIDATOR_INTERNAL_KEY || 'dev_validator_key';
const DATA_DIR = process.env.LEDGER_DATA_DIR || `/tmp/ledger-${VALIDATOR_ID}`;
const LEDGER_PATH = path_1.default.join(DATA_DIR, 'ledger.json');
const PENDING_DIR = path_1.default.join(DATA_DIR, 'pending');
async function ensureDirs() {
    await promises_1.default.mkdir(PENDING_DIR, { recursive: true });
    try {
        await promises_1.default.access(LEDGER_PATH);
    }
    catch {
        await promises_1.default.writeFile(LEDGER_PATH, JSON.stringify({ validatorId: VALIDATOR_ID, blocks: [] }, null, 2), 'utf8');
    }
}
async function readLedger() {
    await ensureDirs();
    const raw = await promises_1.default.readFile(LEDGER_PATH, 'utf8');
    return JSON.parse(raw);
}
async function writeLedger(ledger) {
    await promises_1.default.writeFile(LEDGER_PATH, JSON.stringify(ledger, null, 2), 'utf8');
}
function stableSort(value) {
    if (Array.isArray(value))
        return value.map(stableSort);
    if (value && typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .reduce((acc, key) => {
            acc[key] = stableSort(value[key]);
            return acc;
        }, {});
    }
    return value;
}
function sha256(payload) {
    return crypto_1.default.createHash('sha256').update(payload).digest('hex');
}
function hmac(secret, payload) {
    return crypto_1.default.createHmac('sha256', secret).update(payload).digest('hex');
}
function buildBlockHash(block) {
    return sha256(JSON.stringify(stableSort(block)));
}
function validatorVoteSignature(validatorId, blockHash, committedAt) {
    return hmac(`${AUDIT_HMAC_SECRET}:${validatorId}`, `${validatorId}:${blockHash}:${committedAt}`);
}
function buildValidatorVote(blockHash) {
    const validatorId = VALIDATOR_ID;
    const committedAt = new Date().toISOString();
    return {
        validatorId,
        committedAt,
        signature: validatorVoteSignature(validatorId, blockHash, committedAt),
    };
}
function validateVote(vote, blockHash) {
    if (!vote || typeof vote.validatorId !== 'string' || typeof vote.committedAt !== 'string' || typeof vote.signature !== 'string') {
        return false;
    }
    return validatorVoteSignature(vote.validatorId, blockHash, vote.committedAt) === vote.signature;
}
function validatePendingBlock(block) {
    if (!Number.isInteger(block.requestId) || block.requestId <= 0)
        return 'requestId inválido';
    if (typeof block.eventType !== 'string' || block.eventType.length === 0)
        return 'eventType inválido';
    if (!Number.isInteger(block.blockHeight) || block.blockHeight <= 0)
        return 'blockHeight inválido';
    if (block.previousBlockHash !== null && typeof block.previousBlockHash !== 'string')
        return 'previousBlockHash inválido';
    if (typeof block.payloadDigest !== 'string' || typeof block.challengeHash !== 'string' || typeof block.canonicalMessage !== 'string') {
        return 'payload de custodia inválido';
    }
    if (!Array.isArray(block.actorSignatures) || !Array.isArray(block.systemAttestations) || !Array.isArray(block.validatorCommitCertificate)) {
        return 'colecciones del bloque inválidas';
    }
    if (typeof block.createdAt !== 'string' || typeof block.blockHash !== 'string')
        return 'metadatos de bloque inválidos';
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
    if (block.blockHash !== expectedHash)
        return 'block_hash integrity check failed';
    if (block.validatorCommitCertificate.some((vote) => !validateVote(vote, block.blockHash))) {
        return 'validator_commit_certificate inválido';
    }
    return null;
}
function latestForRequest(blocks, requestId) {
    const filtered = blocks.filter((b) => b.requestId === requestId);
    return filtered.length > 0 ? filtered[filtered.length - 1] : null;
}
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: '512kb' }));
function requireKey(req, res, next) {
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
        .catch((err) => {
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
    const pendingFiles = await promises_1.default.readdir(PENDING_DIR).catch(() => []);
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
    const block = req.body;
    if (!block || typeof block !== 'object' || !block.proposalId) {
        res.status(400).json({ error: 'Invalid block payload' });
        return;
    }
    if (block.proposalId !== req.params.proposalId) {
        res.status(400).json({ error: 'proposalId mismatch' });
        return;
    }
    const validationError = validatePendingBlock(block);
    if (validationError) {
        res.status(400).json({ error: validationError });
        return;
    }
    const pendingPath = path_1.default.join(PENDING_DIR, `${req.params.proposalId}.json`);
    await promises_1.default.writeFile(pendingPath, JSON.stringify(block, null, 2), 'utf8');
    res.json({ proposalId: req.params.proposalId, stored: true });
});
// Commit a pending proposal to the ledger
app.post('/commit/:proposalId', requireKey, async (req, res) => {
    await ensureDirs();
    const pendingPath = path_1.default.join(PENDING_DIR, `${req.params.proposalId}.json`);
    let block;
    try {
        const raw = await promises_1.default.readFile(pendingPath, 'utf8');
        block = JSON.parse(raw);
    }
    catch {
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
    const committedBlock = {
        ...block,
        validatorCommitCertificate: [vote],
    };
    ledger.blocks.push(committedBlock);
    await writeLedger(ledger);
    await promises_1.default.unlink(pendingPath);
    res.json({ proposalId: req.params.proposalId, committed: true, blockHeight: block.blockHeight, vote });
});
// Abort a pending proposal
app.delete('/pending/:proposalId', requireKey, async (req, res) => {
    const pendingPath = path_1.default.join(PENDING_DIR, `${req.params.proposalId}.json`);
    try {
        await promises_1.default.unlink(pendingPath);
    }
    catch {
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
    }
    else {
        res.status(404).json({ proposalId: req.params.proposalId, rolledBack: false, reason: 'not found' });
    }
});
app.put('/committed/:proposalId/certificate', requireKey, async (req, res) => {
    const certificate = req.body?.validatorCommitCertificate;
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
    await promises_1.default.rm(DATA_DIR, { recursive: true, force: true });
    res.json({ validatorId: VALIDATOR_ID, reset: true });
});
app.listen(PORT, () => {
    console.log(`[${VALIDATOR_ID}] Custody validator ready on :${PORT} (data: ${DATA_DIR})`);
});
