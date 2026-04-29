import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/database';
import { authMiddleware, requireRole } from '../auth/middleware';
import { sendError } from '../utils/errors';
import { logger } from '../utils/logger';

const merchantsRouter = Router();

// ── Schemas ───────────────────────────────────────────────────────────────────
const registerSchema = z.object({
    business_name: z.string().min(2),
    email: z.string().email(),
    phone: z.string().optional(),
    address: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
});

const updateStatusSchema = z.object({
    integration_status: z.enum(['active', 'suspended']),
});

const nearbyQuerySchema = z.object({
    lat: z.coerce.number(),
    lon: z.coerce.number(),
    radius: z.coerce.number().positive().default(2),
});

// ── POST /merchants/register (ADMIN only) ─────────────────────────────────────
merchantsRouter.post('/register', authMiddleware, requireRole('ADMIN'), async (req, res) => {
    try {
        const data = registerSchema.parse(req.body);
        const now = new Date().toISOString();

        const { rows: existing } = await db.query('SELECT id FROM merchants WHERE email = $1', [data.email]);
        if (existing.length > 0) {
            return sendError(res, 409, 'EMAIL_CONFLICT', 'Ya existe un merchant con ese email');
        }

        const lat = data.latitude ?? null;
        const lon = data.longitude ?? null;

        const { rows: [merchant] } = await db.query(`
            INSERT INTO merchants (business_name, email, phone, address, latitude, longitude, location, integration_status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5::FLOAT8, $6::FLOAT8,
                    CASE WHEN $5::FLOAT8 IS NOT NULL AND $6::FLOAT8 IS NOT NULL THEN ST_SetSRID(ST_MakePoint($6::FLOAT8, $5::FLOAT8), 4326)::geography ELSE NULL END,
                    'pending', $7, $8) RETURNING *
        `, [data.business_name, data.email, data.phone ?? null, data.address ?? null,
            lat, lon, now, now]);

        logger.info({ business_name: data.business_name, email: data.email }, '[MERCHANT] Registered');
        res.status(201).json(merchant);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return sendError(res, 400, 'BAD_REQUEST', 'Datos de registro inválidos: ' + error.errors.map(e => e.message).join(', '));
        }
        console.error('[MERCHANT] register error:', error);
        sendError(res, 500, 'INTERNAL_ERROR', 'Error registrando merchant');
    }
});

// ── GET /merchants (ADMIN) ────────────────────────────────────────────────────
merchantsRouter.get('/', authMiddleware, requireRole('ADMIN'), async (req, res) => {
    try {
        const { rows: merchants } = await db.query('SELECT * FROM merchants ORDER BY created_at DESC');
        res.json(merchants);
    } catch (error) {
        console.error('[MERCHANT] list error:', error);
        sendError(res, 500, 'INTERNAL_ERROR', 'Error obteniendo merchants');
    }
});

// ── GET /merchants/nearby (CLIENT) ────────────────────────────────────────────
merchantsRouter.get('/nearby', authMiddleware, requireRole('CLIENT'), async (req, res) => {
    try {
        const { lat, lon, radius } = nearbyQuerySchema.parse(req.query);

        const { rows: results } = await db.query(`
            SELECT *,
                   ST_Distance(
                     location,
                     ST_SetSRID(ST_MakePoint($1::FLOAT8, $2::FLOAT8), 4326)::geography
                   ) / 1000.0 AS distance_km
            FROM merchants
            WHERE integration_status = 'active'
              AND location IS NOT NULL
              AND ST_DWithin(
                    location,
                    ST_SetSRID(ST_MakePoint($1::FLOAT8, $2::FLOAT8), 4326)::geography,
                    $3::FLOAT8 * 1000
                  )
            ORDER BY distance_km ASC
        `, [lon, lat, radius]);

        // Round distance for cleaner output
        const cleaned = results.map((m: any) => ({
            ...m,
            distance_km: Math.round(m.distance_km * 1000) / 1000,
        }));

        res.json(cleaned);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return sendError(res, 400, 'BAD_REQUEST', 'Se requieren ?lat=X&lon=Y (y opcionalmente &radius=N)');
        }
        console.error('[MERCHANT] nearby error:', error);
        sendError(res, 500, 'INTERNAL_ERROR', 'Error buscando merchants cercanos');
    }
});

// ── PUT /merchants/:id/status (ADMIN) ─────────────────────────────────────────
merchantsRouter.put('/:id/status', authMiddleware, requireRole('ADMIN'), async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return sendError(res, 400, 'BAD_REQUEST', 'ID inválido');

    try {
        const { integration_status } = updateStatusSchema.parse(req.body);
        const now = new Date().toISOString();

        const { rowCount } = await db.query(
            'UPDATE merchants SET integration_status = $1, updated_at = $2 WHERE id = $3',
            [integration_status, now, id]
        );

        if (rowCount === 0) {
            return sendError(res, 404, 'NOT_FOUND', 'Merchant no encontrado');
        }

        const { rows: [merchant] } = await db.query('SELECT * FROM merchants WHERE id = $1', [id]);
        logger.info({ id, integration_status }, '[MERCHANT] Status updated');
        res.json(merchant);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return sendError(res, 400, 'BAD_REQUEST', 'integration_status debe ser "active" o "suspended"');
        }
        console.error('[MERCHANT] status update error:', error);
        sendError(res, 500, 'INTERNAL_ERROR', 'Error actualizando estado del merchant');
    }
});

// ── GET /merchants/:id (ADMIN) ────────────────────────────────────────────────
merchantsRouter.get('/:id', authMiddleware, requireRole('ADMIN'), async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return sendError(res, 400, 'BAD_REQUEST', 'ID inválido');

    try {
        const { rows: [merchant] } = await db.query('SELECT * FROM merchants WHERE id = $1', [id]);
        if (!merchant) return sendError(res, 404, 'NOT_FOUND', 'Merchant no encontrado');
        res.json(merchant);
    } catch (error) {
        console.error('[MERCHANT] get error:', error);
        sendError(res, 500, 'INTERNAL_ERROR', 'Error obteniendo merchant');
    }
});

export default merchantsRouter;
