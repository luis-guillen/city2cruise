import {
  createCustodyChallenge,
  getSigningIdentity,
  registerSigningKey,
  rotateSigningKey,
  submitCustodySignature,
  type CustodyChallenge,
} from '@/services/api';
import { ensureLocalSigningKey, getStoredSigningKey, signCanonicalMessage } from '@/services/cryptoIdentity';

function stableSort(value: unknown): unknown {
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

async function sha256Hex(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function publicKeyFingerprint(publicKeyJwk: JsonWebKey): Promise<string> {
  return sha256Hex(stableStringify(publicKeyJwk));
}

function getApiErrorCode(err: unknown): string | null {
  const code = (err as { response?: { data?: { error?: { code?: unknown } } } })?.response?.data?.error?.code;
  return typeof code === 'string' ? code : null;
}

async function reconcileSigningIdentity(userId: number): Promise<void> {
  const remote = await getSigningIdentity();
  const local = await ensureLocalSigningKey(userId);
  const localFingerprint = await publicKeyFingerprint(local.publicKeyJwk);

  if (remote.status !== 'ACTIVE') {
    await registerSigningKey(local.publicKeyJwk);
    return;
  }

  if (!remote.fingerprint || remote.fingerprint !== localFingerprint) {
    await rotateSigningKey(local.publicKeyJwk);
  }
}

async function submitSignedChallengeWithRecovery(
  userId: number,
  challenge: CustodyChallenge,
): Promise<CustodyChallenge> {
  const signature = await signCanonicalMessage(userId, challenge.canonicalMessage);
  try {
    return await submitCustodySignature(challenge.id, signature);
  } catch (err) {
    const code = getApiErrorCode(err);
    if (code !== 'INVALID_SIGNATURE' && code !== 'SIGNING_KEY_REQUIRED') {
      throw err;
    }

    await reconcileSigningIdentity(userId);
    const retrySignature = await signCanonicalMessage(userId, challenge.canonicalMessage);
    return submitCustodySignature(challenge.id, retrySignature);
  }
}

export async function ensureDeviceSigningIdentity(userId: number): Promise<void> {
  if (typeof window === 'undefined' || !window.crypto?.subtle || typeof indexedDB === 'undefined') {
    return;
  }
  const stored = await getStoredSigningKey(userId);
  if (!stored) {
    await ensureLocalSigningKey(userId);
  }

  await reconcileSigningIdentity(userId);
}

export async function createAndSignCustodyChallenge(
  userId: number,
  requestId: number,
  eventType: CustodyChallenge['eventType'],
): Promise<CustodyChallenge> {
  const challenge = await createCustodyChallenge(requestId, eventType);
  const signerIds = new Set(challenge.signatures.map((signature) => signature.actorId));
  if (!signerIds.has(userId)) {
    return submitSignedChallengeWithRecovery(userId, challenge);
  }
  return challenge;
}

export async function signExistingCustodyChallenge(
  userId: number,
  challenge: CustodyChallenge,
): Promise<CustodyChallenge> {
  const signerIds = new Set(challenge.signatures.map((signature) => signature.actorId));
  if (signerIds.has(userId)) return challenge;
  return submitSignedChallengeWithRecovery(userId, challenge);
}
