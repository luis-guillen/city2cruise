import crypto from 'crypto';
import { config } from '../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

function getKey(): Buffer {
    const raw = config.fieldEncryptionKey;
    // Accept 64-char hex string (32 bytes) or 32-char ASCII
    if (raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) {
        return Buffer.from(raw, 'hex');
    }
    const buf = Buffer.from(raw, 'utf8');
    if (buf.length < 32) {
        // Pad with zeros to 32 bytes for dev key shorter than 32 chars
        return Buffer.concat([buf, Buffer.alloc(32 - buf.length)]);
    }
    return buf.subarray(0, 32);
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Output format: "<iv_hex>:<tag_hex>:<ciphertext_hex>"
 */
export function encryptField(plain: string): string {
    const key = getKey();
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a field encrypted by encryptField.
 * Returns null if value is null/empty.
 * Falls back to returning the original value if it's not in encrypted format
 * (graceful migration for pre-existing plaintext data).
 */
export function decryptField(encrypted: string | null): string | null {
    if (!encrypted) return null;
    const parts = encrypted.split(':');
    if (parts.length !== 3) return encrypted; // legacy plaintext fallback
    try {
        const key = getKey();
        const [ivHex, tagHex, dataHex] = parts;
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        const data = Buffer.from(dataHex, 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        return decipher.update(data).toString('utf8') + decipher.final('utf8');
    } catch {
        return encrypted; // fallback: return as-is if decryption fails
    }
}
