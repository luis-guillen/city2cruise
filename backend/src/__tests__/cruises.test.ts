import request from 'supertest';
import {
    setupTestDb,
    teardownTestDb,
    createTestApp,
    getAdminToken,
    getClientToken,
    getDriverToken,
    getTestPool,
} from './helpers';

jest.mock('../db/database', () => {
    const actual = jest.requireActual('../db/database');
    return { ...actual, initDB: jest.fn() };
});

jest.mock('../sockets/io', () => ({
    emitEvent: jest.fn(),
    emitToUser: jest.fn(),
    emitToSocket: jest.fn(),
    initSockets: jest.fn(),
    getActiveDrivers: jest.fn(() => []),
}));

describe('Cruise Manifest API', () => {
    let app: any;
    let adminToken: string;
    let clientToken: string;
    let driverToken: string;
    let cruiseId: number;

    beforeAll(async () => {
        await setupTestDb();
        app = createTestApp();
        adminToken = getAdminToken();
        clientToken = getClientToken();
        driverToken = getDriverToken();
    });

    afterAll(async () => {
        await teardownTestDb();
    });

    describe('POST /api/cruises', () => {
        const validPayload = {
            vessel_name: 'Costa Smeralda',
            imo_number: '9781889',
            scheduled_arrival: new Date(Date.now() + 86400000).toISOString(),
            all_aboard: new Date(Date.now() + 86400000 * 1.5).toISOString(),
            departure: new Date(Date.now() + 86400000 * 2).toISOString(),
            terminal: 'Terminal A',
            estimated_passengers: 5000
        };

        it('debería rechazar sin autenticación', async () => {
            const res = await request(app).post('/api/cruises').send(validPayload);
            expect(res.status).toBe(401);
        });

        it('debería rechazar con rol CLIENT', async () => {
            const res = await request(app)
                .post('/api/cruises')
                .set('Authorization', `Bearer ${clientToken}`)
                .send(validPayload);
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('FORBIDDEN');
        });

        it('debería rechazar con rol DRIVER', async () => {
             const res = await request(app)
                .post('/api/cruises')
                .set('Authorization', `Bearer ${driverToken}`)
                .send(validPayload);
            expect(res.status).toBe(403);
        });

        it('debería validar campos obligatorios', async () => {
            const res = await request(app)
                .post('/api/cruises')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ vessel_name: 'Incomplete' });
            
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('debería crear crucero con datos válidos (admin)', async () => {
            const res = await request(app)
                .post('/api/cruises')
                .set('Authorization', `Bearer ${adminToken}`)
                .send(validPayload);
            
            expect(res.status).toBe(201);
            expect(res.body.vessel_name).toBe(validPayload.vessel_name);
            expect(res.body.status).toBe('scheduled');
            expect(res.body.id).toBeDefined();
            
            cruiseId = res.body.id;
        });
    });

    describe('GET /api/cruises', () => {
        beforeAll(async () => {
            const pool = getTestPool();
            await pool.query(`
                INSERT INTO cruise_manifest (vessel_name, scheduled_arrival, all_aboard, departure) 
                VALUES ('Ship 2', '2026-05-01T08:00', '2026-05-01T17:00','2026-05-01T18:00'),
                       ('Ship 3', '2026-05-02T08:00', '2026-05-02T17:00','2026-05-02T18:00')
            `);
            await pool.query(`UPDATE cruise_manifest SET status = 'departed' WHERE vessel_name = 'Ship 2'`);
        });

        it('debería listar cruceros (admin)', async () => {
            const res = await request(app)
                .get('/api/cruises')
                .set('Authorization', `Bearer ${adminToken}`);
            
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('cruises');
            expect(res.body).toHaveProperty('total');
            expect(res.body.cruises.length).toBeGreaterThanOrEqual(3);
        });

        it('debería rechazar con rol no admin', async () => {
            const res = await request(app)
                .get('/api/cruises')
                .set('Authorization', `Bearer ${clientToken}`);
            expect(res.status).toBe(403);
        });

        it('debería filtrar por status', async () => {
            const res = await request(app)
                .get('/api/cruises?status=departed')
                .set('Authorization', `Bearer ${adminToken}`);
            
            expect(res.status).toBe(200);
            expect(res.body.cruises.length).toBe(1);
            expect(res.body.cruises[0].vessel_name).toBe('Ship 2');
        });

        it('debería paginar resultados', async () => {
            const res = await request(app)
                .get('/api/cruises?page=1&limit=2')
                .set('Authorization', `Bearer ${adminToken}`);
            
            expect(res.status).toBe(200);
            expect(res.body.limit).toBe(2);
            expect(res.body.page).toBe(1);
            expect(res.body.cruises.length).toBe(2);
            expect(res.body.total).toBe(3);
        });
    });

    describe('GET /api/cruises/active', () => {
        it('debería retornar solo cruceros scheduled o docked', async () => {
            const res = await request(app)
                .get('/api/cruises/active')
                .set('Authorization', `Bearer ${clientToken}`);
            
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            
            const activeCruises = res.body;
            expect(activeCruises.some((c: any) => c.vessel_name === 'Costa Smeralda')).toBe(true);
            expect(activeCruises.some((c: any) => c.vessel_name === 'Ship 3')).toBe(true);
            expect(activeCruises.some((c: any) => c.status === 'departed')).toBe(false);
        });
    });

    describe('GET /api/cruises/:id', () => {
        it('debería retornar un crucero específico', async () => {
            const res = await request(app)
                .get(`/api/cruises/${cruiseId}`)
                .set('Authorization', `Bearer ${clientToken}`);
            
            expect(res.status).toBe(200);
            expect(res.body.id).toBe(cruiseId);
        });

        it('debería retornar 404 si no existe', async () => {
             const res = await request(app)
                .get(`/api/cruises/9999`)
                .set('Authorization', `Bearer ${clientToken}`);
            
            expect(res.status).toBe(404);
        });

        it('debería retornar 400 si id es inválido', async () => {
            const res = await request(app)
                .get(`/api/cruises/invalid`)
                .set('Authorization', `Bearer ${clientToken}`);
            
            expect(res.status).toBe(400);
        });
    });

    describe('PUT /api/cruises/:id/status', () => {
        it('debería actualizar status', async () => {
            const res = await request(app)
                .put(`/api/cruises/${cruiseId}/status`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ status: 'docked' });
            
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('docked');
            expect(res.body.id).toBe(cruiseId);
        });

        it('debería rechazar status inválido', async () => {
            const res = await request(app)
                .put(`/api/cruises/${cruiseId}/status`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ status: 'flying' });
            
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('debería rechazar si no es admin', async () => {
            const res = await request(app)
                .put(`/api/cruises/${cruiseId}/status`)
                .set('Authorization', `Bearer ${clientToken}`)
                .send({ status: 'departed' });
            
            expect(res.status).toBe(403);
        });

        it('debería manejar error si crucero no existe', async () => {
            const res = await request(app)
                .put(`/api/cruises/9999/status`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ status: 'departed' });
            
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('NOT_FOUND');
        });
        
        it('debería retornar 400 si id es inválido', async () => {
            const res = await request(app)
                .put(`/api/cruises/invalid/status`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ status: 'docked' });
            
            expect(res.status).toBe(400);
        });
    });
});
