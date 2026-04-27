/**
 * Test Helper – Configura una base de datos PostgreSQL de test y una instancia
 * de Express lista para ser consumida por supertest sin levantar servidor HTTP real.
 *
 * IMPORTANTE: usa la base de datos `cruise_connect_test` (via DATABASE_URL).
 * El schema se crea una vez y las tablas se truncan entre suites.
 */
import { Pool } from 'pg';
import { sqlSchema } from '../db/schema.sql';
import bcrypt from 'bcrypt';

// ─── Pool de Test ──────────────────────────────────────────────────────────

const TEST_DATABASE_URL = process.env.DATABASE_URL_TEST
    || 'postgres://pablocabaleironoda@localhost:5432/cruise_connect_test';

let testPool: Pool;

/**
 * Retorna (o crea) el pool de test. Se usa para queries directas en tests.
 */
export const getTestPool = (): Pool => {
    if (!testPool) {
        testPool = new Pool({ connectionString: TEST_DATABASE_URL });
    }
    return testPool;
};

/**
 * Inicializa la DB de test: crea extensiones + schema + seed mínima.
 * Debe llamarse en beforeAll.
 */
export const setupTestDb = async () => {
    const pool = getTestPool();

    // Crear schema desde cero  
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA IF NOT EXISTS public');
    await pool.query('CREATE EXTENSION IF NOT EXISTS postgis');

    // Ejecutar schema completo (todas las tablas)
    await pool.query(sqlSchema);

    // Seed mínima para tests
    const now = new Date().toISOString();
    const hashed = await bcrypt.hash('password123', 10);

    await pool.query(
        'INSERT INTO users (name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5)',
        ['Test Client', 'client@test.com', hashed, 'CLIENT', now]
    );
    await pool.query(
        'INSERT INTO users (name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5)',
        ['Test Driver', 'driver@test.com', hashed, 'DRIVER', now]
    );
    await pool.query(
        'INSERT INTO users (name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5)',
        ['Test Driver 2', 'driver2@test.com', hashed, 'DRIVER', now]
    );
    await pool.query(
        'INSERT INTO users (name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5)',
        ['Test Admin', 'admin@test.com', hashed, 'ADMIN', now]
    );

    // Lockers
    for (let i = 1; i <= 5; i++) {
        await pool.query(
            'INSERT INTO lockers (label, updated_at) VALUES ($1, $2)',
            [`T-${i.toString().padStart(3, '0')}`, now]
        );
    }

    return pool;
};

/**
 * Limpia las tablas de test (truncate con cascade).
 * Para uso entre describe blocks si es necesario.
 */
export const truncateTestDb = async () => {
    const pool = getTestPool();
    await pool.query(`
        TRUNCATE TABLE
            handshake_attempts,
            audit_events,
            notifications,
            pickup_requests,
            lockers,
            cruise_manifest,
            merchants,
            refresh_tokens,
            login_attempts,
            gps_positions,
            users
        CASCADE
    `);
};

/**
 * Cierra el pool de test. Llamar en afterAll.
 */
export const teardownTestDb = async () => {
    if (testPool) {
        await testPool.end();
        testPool = undefined as any;
    }
};

// ─── App para Supertest ────────────────────────────────────────────────────

/**
 * Crea una instancia de la app Express.
 * Debe llamarse DESPUÉS de setupTestDb() y DESPUÉS de configurar los mocks de jest.
 */
export const createTestApp = () => {
    // Importar dinámicamente para que recoja los mocks ya configurados
    const { buildServer } = require('../server');
    return buildServer();
};

// ─── Helpers para Login y Tokens ───────────────────────────────────────────

import { generateToken } from '../auth/jwt';

export const getClientToken = () => generateToken({ id: 1, name: 'Test Client', role: 'CLIENT' });
export const getDriverToken = () => generateToken({ id: 2, name: 'Test Driver', role: 'DRIVER' });
export const getDriver2Token = () => generateToken({ id: 3, name: 'Test Driver 2', role: 'DRIVER' });
export const getAdminToken = () => generateToken({ id: 4, name: 'Test Admin', role: 'ADMIN' });
