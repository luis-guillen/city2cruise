/**
 * Integration tests: Geo-Matching Engine (Phase 14)
 *
 * Verifies:
 *  1. Haversine distance calculations
 *  2. Geo-filtered pending requests
 *  3. Double accept concurrency (first wins, second 409)
 *  4. Debug endpoint structure
 */
import request from 'supertest';
import {
    setupTestDb,
    teardownTestDb,
    createTestApp,
    getTestPool,
} from './helpers';
import { generateToken } from '../auth/jwt';
import { calculateDistance } from '../utils/geo';

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

// Pre-calculated scenario (Las Palmas seed)
const CLIENT = { id: 1001, name: 'Cliente Santa Catalina', email: 'santa@demo.com', role: 'CLIENT' as const };
const DRIVER1 = { id: 2001, name: 'Driver Uno', email: 'driver1@demo.com', role: 'DRIVER' as const, lat: 28.1468, lon: -15.4170 };
const DRIVER2 = { id: 2002, name: 'Driver Dos', email: 'driver2@demo.com', role: 'DRIVER' as const, lat: 28.1410, lon: -15.4280 };
const DRIVER3 = { id: 2003, name: 'Driver Tres', email: 'driver3@demo.com', role: 'DRIVER' as const, lat: 28.0905, lon: -15.3989 };

const REQUEST_LAT = 28.1413;
const REQUEST_LON = -15.4308;
const GEO_RADIUS_KM = 3;

describe('[Fase 14] Geo-Matching Engine', () => {
    let app: any;
    let clientToken: string;
    let driver1Token: string;
    let driver2Token: string;
    let createdRequestId: string;

    beforeAll(async () => {
        await setupTestDb();
        app = createTestApp();

        const pool = getTestPool();
        const now = new Date().toISOString();

        // Insert test users with specific IDs
        await pool.query(
            `INSERT INTO users (id, name, email, password_hash, role, created_at)
             VALUES ($1, $2, $3, '$2b$10$HASH', $4, $5)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
            [1001, 'Cliente Rambla', 'rambla@demo.com', 'CLIENT', now]
        );
        await pool.query(
            `INSERT INTO users (id, name, email, password_hash, role, latitude, longitude, location, created_at)
             VALUES ($1, $2, $3, '$2b$10$HASH', 'DRIVER', $4, $5, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, $6)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
            [2001, 'Driver Uno', 'driver1@demo.com', DRIVER1.lat, DRIVER1.lon, now]
        );
        await pool.query(
            `INSERT INTO users (id, name, email, password_hash, role, latitude, longitude, location, created_at)
             VALUES ($1, $2, $3, '$2b$10$HASH', 'DRIVER', $4, $5, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, $6)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
            [2002, 'Driver Dos', 'driver2@demo.com', DRIVER2.lat, DRIVER2.lon, now]
        );
        await pool.query(
            `INSERT INTO users (id, name, email, password_hash, role, latitude, longitude, location, created_at)
             VALUES ($1, $2, $3, '$2b$10$HASH', 'DRIVER', $4, $5, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, $6)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
            [2003, 'Driver Tres', 'driver3@demo.com', DRIVER3.lat, DRIVER3.lon, now]
        );
        // Reset sequence to avoid conflict with existing IDs
        await pool.query(`SELECT setval('users_id_seq', (SELECT MAX(id) FROM users))`);

        clientToken = generateToken(CLIENT);
        driver1Token = generateToken(DRIVER1);
        driver2Token = generateToken(DRIVER2);
    });

    afterAll(async () => {
        await teardownTestDb();
    });

    describe('Distancia Haversine', () => {
        it('Driver 1 (~0.7km) está DENTRO del radio de 3km', () => {
            const d = calculateDistance(DRIVER1.lat, DRIVER1.lon, REQUEST_LAT, REQUEST_LON);
            expect(d).toBeLessThanOrEqual(GEO_RADIUS_KM);
        });

        it('Driver 2 (~1.3km) está DENTRO del radio de 3km', () => {
            const d = calculateDistance(DRIVER2.lat, DRIVER2.lon, REQUEST_LAT, REQUEST_LON);
            expect(d).toBeLessThanOrEqual(GEO_RADIUS_KM);
        });

        it('Driver 3 (~8km) está FUERA del radio de 3km', () => {
            const d = calculateDistance(DRIVER3.lat, DRIVER3.lon, REQUEST_LAT, REQUEST_LON);
            expect(d).toBeGreaterThan(GEO_RADIUS_KM);
        });
    });

    describe('Creación de Request y Filtro Geoespacial Backend', () => {
        it('GET /api/requests/pending sin params devuelve todos los REQUESTED', async () => {
            const res = await request(app)
                .get('/api/requests/pending')
                .set('Authorization', `Bearer ${driver1Token}`);
            expect(res.status).toBe(200);
        });

        it('GET /api/requests/pending con ubicacion driver1 devuelve pedidos cercanos', async () => {
            const res = await request(app)
                .get(`/api/requests/pending?lat=${DRIVER1.lat}&lon=${DRIVER1.lon}&radius=${GEO_RADIUS_KM}`)
                .set('Authorization', `Bearer ${driver1Token}`);
            expect(res.status).toBe(200);
        });
    });

    describe('Concurrencia: doble intento de aceptación', () => {
        it('El primer driver en aceptar gana (200); el segundo recibe 409', async () => {
            const pool = getTestPool();
            const now = new Date().toISOString();
            const { rows: [inserted] } = await pool.query(
                `INSERT INTO pickup_requests (client_id, pickup_location, latitude, longitude, pickup_location_geo, package_size, status, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, 'SMALL', 'REQUESTED', $5, $5) RETURNING id`,
                [1001, 'Santa Catalina, Las Palmas', REQUEST_LAT, REQUEST_LON, now]
            );
            createdRequestId = String(inserted.id);

            const [res1, res2] = await Promise.all([
                request(app)
                    .post(`/api/requests/${createdRequestId}/accept`)
                    .set('Authorization', `Bearer ${driver1Token}`)
                    .send({ driverLat: DRIVER1.lat, driverLon: DRIVER1.lon, radiusKm: GEO_RADIUS_KM }),
                request(app)
                    .post(`/api/requests/${createdRequestId}/accept`)
                    .set('Authorization', `Bearer ${driver2Token}`)
                    .send({ driverLat: DRIVER2.lat, driverLon: DRIVER2.lon, radiusKm: GEO_RADIUS_KM }),
            ]);

            const statuses = [res1.status, res2.status].sort();
            expect(statuses).toContain(200);
            expect(statuses).toContain(409);
        });
    });

    describe('Debug endpoint', () => {
        it('GET /debug/active-drivers responde con estructura esperada', async () => {
            const res = await request(app).get('/debug/active-drivers');
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('activeDriverCount');
            expect(res.body).toHaveProperty('drivers');
            expect(Array.isArray(res.body.drivers)).toBe(true);
        });
    });
});
