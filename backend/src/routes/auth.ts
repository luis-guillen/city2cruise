import { Router } from 'express';
import { db } from '../db/database';
import { generateToken } from '../auth/jwt';
import { sendError } from '../utils/errors';
import { UserDTO } from '../types/dto';
import bcrypt from 'bcrypt';
import { registerSchema, loginSchema } from '../schemas/auth.schemas';
import { validateBody } from '../middleware/validateSchema';

const authRouter = Router();

authRouter.post('/register', validateBody(registerSchema), async (req, res) => {
    try {
        console.log('[Auth] Register attempt:', req.body);
        const data = req.body;
        console.log('[Auth] Validated data:', data);

        const normalizedEmail = data.email.toLowerCase();

        // Check if email exists
        const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
        if (rows.length > 0) {
            return sendError(res, 409, 'CONFLICT', 'El correo electrónico ya está registrado');
        }

        const passwordHash = await bcrypt.hash(data.password, 10);
        const now = new Date().toISOString();

        const { rows: [inserted] } = await db.query(
            `INSERT INTO users (name, email, password_hash, role, vehicle_identifier, accessibility_profile, device_identifier, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [data.name, normalizedEmail, passwordHash, data.role,
             data.vehicle_identifier ?? null, data.accessibility_profile, data.device_identifier ?? null, now]
        );

        const userDto: UserDTO = {
            id: inserted.id,
            name: data.name,
            role: data.role
        };

        const token = generateToken(userDto);
        res.status(201).json({ token, user: userDto });
    } catch (error) {
        console.error('[Auth] Unexpected registration error:', error);
        throw error;
    }
});

authRouter.post('/login', validateBody(loginSchema), async (req, res) => {
    try {
        const data = req.body;

        const normalizedEmail = data.email.toLowerCase();

        const { rows: [user] } = await db.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);

        if (!user) {
            return sendError(res, 401, 'UNAUTHORIZED', 'Credenciales incorrectas');
        }

        const isValid = await bcrypt.compare(data.password, user.password_hash);
        if (!isValid) {
            return sendError(res, 401, 'UNAUTHORIZED', 'Credenciales incorrectas');
        }

        const userDto: UserDTO = {
            id: user.id,
            name: user.name,
            role: user.role,
            latitude: user.latitude ?? null,
            longitude: user.longitude ?? null
        };

        const token = generateToken(userDto);

        res.json({ token, user: userDto });
    } catch (error) {
        throw error;
    }
});

export default authRouter;
