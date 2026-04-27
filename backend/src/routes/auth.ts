import { Router } from 'express';
import { db } from '../db/database';
import { generateAccessToken } from '../auth/jwt';
import { authMiddleware } from '../auth/middleware';
import { issueRefreshToken, rotateRefreshToken, revokeRefreshToken, revokeAllUserRefreshTokens } from '../auth/refreshTokenService';
import { sendError } from '../utils/errors';
import { UserDTO } from '../types/dto';
import bcrypt from 'bcrypt';
import { registerSchema, loginSchema, changePasswordSchema } from '../schemas/auth.schemas';
import { validateBody } from '../middleware/validateSchema';
import { loginThrottle, recordLoginAttempt } from '../middleware/loginThrottle';
import { config } from '../config/env';

const authRouter = Router();

const COOKIE_NAME = 'refresh_token';

function setRefreshCookie(res: any, token: string): void {
    res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        secure: config.env === 'production',
        sameSite: 'lax' as const,
        path: '/api/auth',
        maxAge: config.refreshTokenExpiryDays * 24 * 60 * 60 * 1000,
    });
}

function clearRefreshCookie(res: any): void {
    res.clearCookie(COOKIE_NAME, { path: '/api/auth' });
}

// POST /api/auth/register
authRouter.post('/register', validateBody(registerSchema), async (req, res) => {
    try {
        const data = req.body;
        const normalizedEmail = data.email.toLowerCase();

        const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
        if (rows.length > 0) {
            return sendError(res, 409, 'CONFLICT', 'El correo electrónico ya está registrado');
        }

        const passwordHash = await bcrypt.hash(data.password, 12);
        const now = new Date().toISOString();

        const { rows: [inserted] } = await db.query(
            `INSERT INTO users (name, email, password_hash, role, vehicle_identifier, accessibility_profile, device_identifier, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [data.name, normalizedEmail, passwordHash, data.role,
             data.vehicle_identifier ?? null, data.accessibility_profile, data.device_identifier ?? null, now]
        );

        const userDto: UserDTO = { id: inserted.id, name: data.name, role: data.role };
        const accessToken = generateAccessToken(userDto);
        const refreshToken = await issueRefreshToken(inserted.id);

        setRefreshCookie(res, refreshToken);
        res.status(201).json({ token: accessToken, user: userDto });
    } catch (error) {
        throw error;
    }
});

// POST /api/auth/login
authRouter.post('/login', loginThrottle, validateBody(loginSchema), async (req, res) => {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim()
        ?? req.socket.remoteAddress
        ?? 'unknown';

    try {
        const data = req.body;
        const normalizedEmail = data.email.toLowerCase();

        const { rows: [user] } = await db.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);

        if (!user) {
            await recordLoginAttempt(ip, normalizedEmail, false);
            return sendError(res, 401, 'UNAUTHORIZED', 'Credenciales incorrectas');
        }

        const isValid = await bcrypt.compare(data.password, user.password_hash);
        if (!isValid) {
            await recordLoginAttempt(ip, normalizedEmail, false);
            return sendError(res, 401, 'UNAUTHORIZED', 'Credenciales incorrectas');
        }

        await recordLoginAttempt(ip, normalizedEmail, true);

        const userDto: UserDTO = {
            id: user.id,
            name: user.name,
            role: user.role,
            latitude: user.latitude ?? null,
            longitude: user.longitude ?? null,
        };

        const accessToken = generateAccessToken(userDto);
        const refreshToken = await issueRefreshToken(user.id);

        setRefreshCookie(res, refreshToken);
        res.json({ token: accessToken, user: userDto });
    } catch (error) {
        throw error;
    }
});

// POST /api/auth/refresh
authRouter.post('/refresh', async (req, res) => {
    const rawToken = req.cookies?.[COOKIE_NAME];
    if (!rawToken) {
        return sendError(res, 401, 'UNAUTHORIZED', 'Refresh token no encontrado');
    }

    try {
        const result = await rotateRefreshToken(rawToken);
        if (!result) {
            clearRefreshCookie(res);
            return sendError(res, 401, 'UNAUTHORIZED', 'Refresh token inválido o expirado');
        }

        const { rows: [user] } = await db.query(
            'SELECT id, name, role, latitude, longitude FROM users WHERE id = $1',
            [result.userId]
        );
        if (!user) {
            clearRefreshCookie(res);
            return sendError(res, 401, 'UNAUTHORIZED', 'Usuario no encontrado');
        }

        const userDto: UserDTO = {
            id: user.id,
            name: user.name,
            role: user.role,
            latitude: user.latitude ?? null,
            longitude: user.longitude ?? null,
        };

        const accessToken = generateAccessToken(userDto);
        setRefreshCookie(res, result.newRawToken);
        res.json({ token: accessToken, user: userDto });
    } catch (error) {
        throw error;
    }
});

// POST /api/auth/logout
authRouter.post('/logout', async (req, res) => {
    const rawToken = req.cookies?.[COOKIE_NAME];
    if (rawToken) {
        await revokeRefreshToken(rawToken);
    }
    clearRefreshCookie(res);
    res.json({ success: true });
});

// POST /api/auth/logout-all
authRouter.post('/logout-all', authMiddleware, async (req, res) => {
    await revokeAllUserRefreshTokens(req.user!.id);
    clearRefreshCookie(res);
    res.json({ success: true });
});

// PATCH /api/auth/password
authRouter.patch('/password', authMiddleware, validateBody(changePasswordSchema), async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        const { rows: [user] } = await db.query(
            'SELECT password_hash FROM users WHERE id = $1',
            [req.user!.id]
        );

        const isValid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isValid) {
            return sendError(res, 401, 'UNAUTHORIZED', 'La contraseña actual es incorrecta');
        }

        const newHash = await bcrypt.hash(newPassword, 12);
        await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user!.id]);

        // Revocar todos los refresh tokens (fuerza re-login en todos los dispositivos)
        await revokeAllUserRefreshTokens(req.user!.id);
        clearRefreshCookie(res);

        res.json({ success: true, message: 'Contraseña actualizada. Por favor inicia sesión de nuevo.' });
    } catch (error) {
        throw error;
    }
});

export default authRouter;
