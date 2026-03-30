import { Router } from 'express';
import { db } from '../db/database';
import { authMiddleware, requireRole } from '../auth/middleware';
import { sendError } from '../utils/errors';
import { validateBody } from '../middleware/validateSchema';
import { createCruiseSchema, updateCruiseStatusSchema } from '../schemas/cruise.schemas';
import { z } from 'zod';

const cruisesRouter = Router();

const paginationSchema = z.object({
    page:   z.coerce.number().int().min(1).default(1),
    limit:  z.coerce.number().int().min(1).max(200).default(50),
    status: z.string().optional(),
});

// GET /cruises/active — cruceros activos (todos los roles)
cruisesRouter.get('/active', authMiddleware, async (req, res) => {
    try {
        const { rows } = await db.query(
            "SELECT * FROM cruise_manifest WHERE status IN ('scheduled','docked') ORDER BY scheduled_arrival ASC"
        );
        res.json(rows);
    } catch (error) {
        sendError(res, 500, 'INTERNAL_ERROR', 'Error obteniendo cruceros activos');
    }
});

// GET /cruises — listar con paginación y filtro de status (ADMIN)
cruisesRouter.get('/', authMiddleware, requireRole('ADMIN'), async (req, res) => {
    try {
        const { page, limit, status } = paginationSchema.parse(req.query);
        const offset = (page - 1) * limit;

        let rows, total;
        if (status) {
            ({ rows } = await db.query(
                'SELECT * FROM cruise_manifest WHERE status = $1 ORDER BY scheduled_arrival DESC LIMIT $2 OFFSET $3',
                [status, limit, offset]
            ));
            const result = await db.query('SELECT COUNT(*)::int as n FROM cruise_manifest WHERE status = $1', [status]);
            total = result.rows[0].n;
        } else {
            ({ rows } = await db.query(
                'SELECT * FROM cruise_manifest ORDER BY scheduled_arrival DESC LIMIT $1 OFFSET $2',
                [limit, offset]
            ));
            const result = await db.query('SELECT COUNT(*)::int as n FROM cruise_manifest');
            total = result.rows[0].n;
        }

        res.json({ page, limit, total, cruises: rows });
    } catch (error) {
        sendError(res, 500, 'INTERNAL_ERROR', 'Error listando cruceros');
    }
});

// GET /cruises/:id — detalle (auth any role)
cruisesRouter.get('/:id', authMiddleware, async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return sendError(res, 400, 'BAD_REQUEST', 'ID inválido');

    try {
        const { rows: [row] } = await db.query('SELECT * FROM cruise_manifest WHERE id = $1', [id]);
        if (!row) return sendError(res, 404, 'NOT_FOUND', 'Crucero no encontrado');
        res.json(row);
    } catch (error) {
        sendError(res, 500, 'INTERNAL_ERROR', 'Error obteniendo crucero');
    }
});

// POST /cruises — crear (ADMIN)
cruisesRouter.post('/', authMiddleware, requireRole('ADMIN'), validateBody(createCruiseSchema), async (req, res) => {
    try {
        const d = req.body;
        const { rows: [row] } = await db.query(`
            INSERT INTO cruise_manifest (vessel_name, imo_number, scheduled_arrival, all_aboard, departure, terminal, estimated_passengers, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled') RETURNING *
        `, [d.vessel_name, d.imo_number ?? null, d.scheduled_arrival, d.all_aboard, d.departure, d.terminal ?? null, d.estimated_passengers]);

        res.status(201).json(row);
    } catch (error) {
        sendError(res, 500, 'INTERNAL_ERROR', 'Error creando crucero');
    }
});

// PUT /cruises/:id/status — actualizar estado (ADMIN)
cruisesRouter.put('/:id/status', authMiddleware, requireRole('ADMIN'), validateBody(updateCruiseStatusSchema), async (req, res) => {
    const id = Number(req.params.id);
    if (isNaN(id)) return sendError(res, 400, 'BAD_REQUEST', 'ID inválido');

    try {
        const { rowCount } = await db.query('UPDATE cruise_manifest SET status = $1 WHERE id = $2', [req.body.status, id]);
        if (rowCount === 0) return sendError(res, 404, 'NOT_FOUND', 'Crucero no encontrado');

        const { rows: [row] } = await db.query('SELECT * FROM cruise_manifest WHERE id = $1', [id]);
        res.json(row);
    } catch (error) {
        sendError(res, 500, 'INTERNAL_ERROR', 'Error actualizando estado del crucero');
    }
});

export default cruisesRouter;
