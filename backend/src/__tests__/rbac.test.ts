/**
 * Hito 6.3.3 — Tests de autorización: RBAC + IDOR.
 *
 * No requiere DB: monta una mini-app Express con SOLO los middlewares y
 * stub handlers para validar las decisiones de auth/authz.
 */
import express, { Request, Response } from 'express';
import request from 'supertest';
import { authMiddleware, requireRole } from '../auth/middleware';
import { generateAccessToken } from '../auth/jwt';

function app() {
    const a = express();
    a.use(express.json());

    // Endpoint público
    a.get('/public', (_req, res) => res.json({ ok: true, public: true }));

    // Endpoint que requiere SOLO autenticación (cualquier rol)
    a.get('/me', authMiddleware, (req: Request, res: Response) => {
        res.json({ id: req.user!.id, role: req.user!.role });
    });

    // Endpoints específicos por rol
    a.get('/client-only', authMiddleware, requireRole('CLIENT'), (_req, res) => res.json({ ok: true }));
    a.get('/driver-only', authMiddleware, requireRole('DRIVER'), (_req, res) => res.json({ ok: true }));
    a.get('/admin-only', authMiddleware, requireRole('ADMIN'), (_req, res) => res.json({ ok: true }));

    // IDOR: /requests/:id devuelve éxito sólo si :id == req.user.id
    a.get('/requests/:id', authMiddleware, (req: Request, res: Response) => {
        if (Number(req.params.id) !== req.user!.id) {
            return res.status(403).json({ error: 'IDOR — no puedes acceder a recursos de otro user' });
        }
        return res.json({ id: req.params.id });
    });

    return a;
}

function tokenFor(role: 'CLIENT' | 'DRIVER' | 'ADMIN', id = 1) {
    return generateAccessToken({ id, role, name: `User${id}` });
}

describe('Hito 6.3.3 — RBAC: cliente NO puede acceder a recursos de otros roles', () => {
    const a = app();

    it('GET /public devuelve 200 sin auth (sanity check)', async () => {
        const r = await request(a).get('/public');
        expect(r.status).toBe(200);
    });

    it('GET /me sin token devuelve 401', async () => {
        const r = await request(a).get('/me');
        expect(r.status).toBe(401);
    });

    it('GET /me con Bearer falso devuelve 401', async () => {
        const r = await request(a).get('/me').set('Authorization', 'Bearer not-a-jwt');
        expect(r.status).toBe(401);
    });

    it('GET /me con token CLIENT válido devuelve 200', async () => {
        const r = await request(a).get('/me').set('Authorization', `Bearer ${tokenFor('CLIENT')}`);
        expect(r.status).toBe(200);
        expect(r.body.role).toBe('CLIENT');
    });

    // Matriz de roles vs endpoints
    it('CLIENT NO puede acceder a /driver-only', async () => {
        const r = await request(a).get('/driver-only').set('Authorization', `Bearer ${tokenFor('CLIENT')}`);
        expect(r.status).toBe(403);
    });

    it('CLIENT NO puede acceder a /admin-only', async () => {
        const r = await request(a).get('/admin-only').set('Authorization', `Bearer ${tokenFor('CLIENT')}`);
        expect(r.status).toBe(403);
    });

    it('DRIVER NO puede acceder a /client-only', async () => {
        const r = await request(a).get('/client-only').set('Authorization', `Bearer ${tokenFor('DRIVER')}`);
        expect(r.status).toBe(403);
    });

    it('DRIVER NO puede acceder a /admin-only', async () => {
        const r = await request(a).get('/admin-only').set('Authorization', `Bearer ${tokenFor('DRIVER')}`);
        expect(r.status).toBe(403);
    });

    it('ADMIN NO puede acceder a /client-only ni /driver-only (rol estricto)', async () => {
        const adminTok = tokenFor('ADMIN');
        const r1 = await request(a).get('/client-only').set('Authorization', `Bearer ${adminTok}`);
        const r2 = await request(a).get('/driver-only').set('Authorization', `Bearer ${adminTok}`);
        expect(r1.status).toBe(403);
        expect(r2.status).toBe(403);
    });

    it('Cada rol PUEDE acceder a SU endpoint', async () => {
        const c = await request(a).get('/client-only').set('Authorization', `Bearer ${tokenFor('CLIENT')}`);
        const d = await request(a).get('/driver-only').set('Authorization', `Bearer ${tokenFor('DRIVER')}`);
        const x = await request(a).get('/admin-only').set('Authorization', `Bearer ${tokenFor('ADMIN')}`);
        expect(c.status).toBe(200);
        expect(d.status).toBe(200);
        expect(x.status).toBe(200);
    });
});

describe('Hito 6.3.3 — IDOR: usuario NO puede ver recursos de otro user', () => {
    const a = app();

    it('User #1 puede ver SU propio recurso /requests/1', async () => {
        const r = await request(a).get('/requests/1').set('Authorization', `Bearer ${tokenFor('CLIENT', 1)}`);
        expect(r.status).toBe(200);
    });

    it('User #1 NO puede ver /requests/2 (recurso de user #2) — IDOR bloqueado', async () => {
        const r = await request(a).get('/requests/2').set('Authorization', `Bearer ${tokenFor('CLIENT', 1)}`);
        expect(r.status).toBe(403);
    });

    it('Manipular el path con %2F u otros caracteres no rompe el check', async () => {
        const r = await request(a).get('/requests/2%20OR%201%3D1').set('Authorization', `Bearer ${tokenFor('CLIENT', 1)}`);
        // Number("...") devuelve NaN para esos paths, !== 1 → 403
        expect([403, 404]).toContain(r.status);
    });
});
