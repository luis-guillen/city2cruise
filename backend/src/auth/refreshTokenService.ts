import crypto from 'crypto';
import { createId } from '@paralleldrive/cuid2';
import { db } from '../db/database';
import { config } from '../config/env';
import { logger } from '../utils/logger';

function hashToken(rawToken: string): string {
    return crypto.createHmac('sha256', config.refreshTokenSecret).update(rawToken).digest('hex');
}

function expiresAt(): Date {
    return new Date(Date.now() + config.refreshTokenExpiryDays * 24 * 60 * 60 * 1000);
}

/**
 * Emite un nuevo refresh token para el usuario. Devuelve el token en claro
 * (solo se envía al cliente una vez vía cookie).
 */
export async function issueRefreshToken(userId: number): Promise<string> {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const familyId = createId();
    const id = createId();

    await db.query(
        `INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, issued_at, expires_at)
         VALUES ($1, $2, $3, $4, NOW(), $5)`,
        [id, userId, tokenHash, familyId, expiresAt()]
    );

    logger.debug({ userId, tokenId: id }, 'Refresh token issued');
    return rawToken;
}

/**
 * Valida y rota un refresh token.
 * - Si el token es válido: lo revoca y emite uno nuevo (misma familia).
 * - Si el token fue ya revocado (reuso): invalida toda la familia.
 * Devuelve { userId, newRawToken } o null si no es válido.
 */
export async function rotateRefreshToken(
    rawToken: string
): Promise<{ userId: number; newRawToken: string } | null> {
    const tokenHash = hashToken(rawToken);

    const { rows: [existing] } = await db.query(
        `SELECT * FROM refresh_tokens WHERE token_hash = $1`,
        [tokenHash]
    );

    if (!existing) {
        logger.warn('Refresh token not found');
        return null;
    }

    if (existing.revoked_at) {
        // Token reutilizado → posible robo → revocar familia entera
        await db.query(
            `UPDATE refresh_tokens SET revoked_at = NOW()
             WHERE family_id = $1 AND revoked_at IS NULL`,
            [existing.family_id]
        );
        logger.warn({ familyId: existing.family_id, userId: existing.user_id }, 'Token reuse detected — family revoked');
        return null;
    }

    if (new Date(existing.expires_at) < new Date()) {
        logger.warn({ tokenId: existing.id }, 'Refresh token expired');
        return null;
    }

    const newRawToken = crypto.randomBytes(32).toString('hex');
    const newTokenHash = hashToken(newRawToken);
    const newId = createId();

    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by = $1 WHERE id = $2`,
            [newId, existing.id]
        );
        await client.query(
            `INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, issued_at, expires_at)
             VALUES ($1, $2, $3, $4, NOW(), $5)`,
            [newId, existing.user_id, newTokenHash, existing.family_id, expiresAt()]
        );
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    logger.debug({ userId: existing.user_id, newTokenId: newId }, 'Refresh token rotated');
    return { userId: existing.user_id, newRawToken };
}

/**
 * Revoca el refresh token identificado por el valor en claro.
 */
export async function revokeRefreshToken(rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    await db.query(
        `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL`,
        [tokenHash]
    );
}

/**
 * Revoca todos los refresh tokens activos del usuario (logout-all / cambio de contraseña).
 */
export async function revokeAllUserRefreshTokens(userId: number): Promise<void> {
    await db.query(
        `UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId]
    );
    logger.info({ userId }, 'All refresh tokens revoked');
}
