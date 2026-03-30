/**
 * Adaptador de conexión PostgreSQL para Cruise Connect.
 *
 * Reemplaza el driver síncrono `better-sqlite3` por un Pool asíncrono de `pg`.
 *
 * Exportaciones principales:
 *  - pool:      instancia de pg.Pool (no usar directamente salvo en tests)
 *  - db.query:  ejecuta una query parametrizada (text + params)
 *  - db.getClient: obtiene un PoolClient para transacciones manuales
 *  - initDB:    aplica el esquema y seed inicial
 */
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from '../config/env';
import { sqlSchema } from './schema.sql';
import bcrypt from 'bcrypt';
import { logger } from '../utils/logger';

// ─── Pool de conexiones ────────────────────────────────────────────────────

export const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 20,                   // conexiones máximas en el pool
    idleTimeoutMillis: 30_000, // cerrar conexiones idle tras 30s
    connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
});

// ─── Interfaz pública ──────────────────────────────────────────────────────

export const db = {
    /**
     * Ejecutar una query parametrizada.
     * Uso: const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
     */
    query: <T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> => {
        return pool.query<T>(text, params);
    },

    /**
     * Obtener un PoolClient para transacciones.
     * USO:
     *   const client = await db.getClient();
     *   try {
     *     await client.query('BEGIN');
     *     // ... queries ...
     *     await client.query('COMMIT');
     *   } catch (e) {
     *     await client.query('ROLLBACK');
     *     throw e;
     *   } finally {
     *     client.release();
     *   }
     */
    getClient: (): Promise<PoolClient> => {
        return pool.connect();
    },

    /**
     * Cerrar el pool (para apagado graceful).
     */
    end: (): Promise<void> => {
        return pool.end();
    },
};

// ─── Inicialización de la BD ───────────────────────────────────────────────

export const initDB = async (): Promise<void> => {
    const client = await pool.connect();
    try {
        // Aplicar esquema completo (idempotente por los IF NOT EXISTS)
        await client.query(sqlSchema);
        logger.info('PostgreSQL schema applied');

        // Seed si la tabla users está vacía
        const result = await client.query('SELECT COUNT(*)::int AS count FROM users');
        const userCount = result.rows[0].count;

        if (userCount === 0) {
            logger.info('Empty database detected — running seeder...');
            const now = new Date().toISOString();
            const defaultHash = await bcrypt.hash('password123', 10);

            // Usuarios demo
            await client.query(
                'INSERT INTO users (name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5)',
                ['Super Admin', 'admin@test.com', defaultHash, 'ADMIN', now]
            );
            await client.query(
                'INSERT INTO users (name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5)',
                ['Demo Client', 'client@test.com', defaultHash, 'CLIENT', now]
            );
            await client.query(
                'INSERT INTO users (name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5)',
                ['Client Cerca', 'clientcerca@test.com', defaultHash, 'CLIENT', now]
            );
            await client.query(
                'INSERT INTO users (name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5)',
                ['Client Medio', 'clientmedio@test.com', defaultHash, 'CLIENT', now]
            );
            await client.query(
                'INSERT INTO users (name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5)',
                ['Client Lejos', 'clientlejos@test.com', defaultHash, 'CLIENT', now]
            );
            await client.query(
                'INSERT INTO users (name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5)',
                ['Demo Driver', 'driver@test.com', defaultHash, 'DRIVER', now]
            );

            // ── Drivers Demo para Cascada (Sin coordenadas fijas) ──
            const demoDrivers = [
                { name: 'Driver Cerca (3km)', email: 'drivercerca@test.com' },
                { name: 'Driver Medio (5km)', email: 'drivermedio@test.com' },
                { name: 'Driver Lejos (7km+)', email: 'driverlejos@test.com' },
            ];

            for (const d of demoDrivers) {
                await client.query(
                    `INSERT INTO users (name, email, password_hash, role, created_at)
                     VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (email) DO NOTHING`,
                    [d.name, d.email, defaultHash, 'DRIVER', now]
                );
            }

            // Lockers
            for (let i = 1; i <= 20; i++) {
                const numStr = i.toString().padStart(3, '0');
                const sizeCategory = i <= 7 ? 'S' : i <= 14 ? 'M' : 'L';
                await client.query(
                    'INSERT INTO lockers (label, size_category, updated_at) VALUES ($1, $2, $3)',
                    [`L-${numStr}`, sizeCategory, now]
                );
            }

            // Merchants demo
            const merchantValues = [
                ['Supermercado Santa Catalina', 'santacatalina@demo.com', '+34 928 100 001',
                 'C/ Ripoche 4, Las Palmas de Gran Canaria', 28.1413, -15.4308, 'active', now, now],
                ['Farmacia Puerto', 'farmacia@demo.com', '+34 928 100 002',
                 'Av. Marítima del Norte 32, Las Palmas de Gran Canaria', 28.1460, -15.4190, 'active', now, now],
                ['Librería Triana', 'libreria@demo.com', '+34 928 100 003',
                 'C/ Mayor de Triana 68, Las Palmas de Gran Canaria', 28.1062, -15.4152, 'pending', now, now],
            ];

            for (const m of merchantValues) {
                await client.query(
                    `INSERT INTO merchants (business_name, email, phone, address, latitude, longitude, location, integration_status, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5::FLOAT8, $6::FLOAT8,
                             CASE WHEN $5::FLOAT8 IS NOT NULL AND $6::FLOAT8 IS NOT NULL THEN ST_SetSRID(ST_MakePoint($6::FLOAT8, $5::FLOAT8), 4326)::geography ELSE NULL END,
                             $7, $8, $9)`,
                    m
                );
            }

            logger.info('Seeder completed (Users, Lockers, Merchants)');
        } else {
            logger.info({ userCount }, 'Database ready');
        }
    } finally {
        client.release();
    }
};
