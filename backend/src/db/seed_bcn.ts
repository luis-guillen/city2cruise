/**
 * Seed script: Escenario controlado de Barcelona (Fase 14)
 * Genera usuarios con ubicaciones reales para pruebas de geo-matching.
 *
 * Uso: npm run seed-bcn
 */
import { pool, initDB } from './database';

async function main() {
    console.error('[seed-bcn] Iniciando escenario de prueba Barcelona...');

    const client = await pool.connect();
    try {
        // Limpiar tablas en orden correcto (respetando FKs)
        await client.query('DROP SCHEMA public CASCADE');
        await client.query('CREATE SCHEMA public');

        // Reiniciar DB con esquema y seed por defecto
        await initDB();

        const bcrypt = require('bcrypt');
        const now = new Date().toISOString();
        const hash = await bcrypt.hash('password123', 10);

        const insertUser = async (name: string, email: string, role: string, lat: number | null, lon: number | null) => {
            await client.query(
                `INSERT INTO users (name, email, password_hash, role, latitude, longitude, location, created_at)
                 VALUES ($1, $2, $3, $4, $5::FLOAT8, $6::FLOAT8,
                         CASE WHEN $5::FLOAT8 IS NOT NULL AND $6::FLOAT8 IS NOT NULL THEN ST_SetSRID(ST_MakePoint($6::FLOAT8, $5::FLOAT8), 4326)::geography ELSE NULL END,
                         $7)
                 ON CONFLICT (email) DO NOTHING`,
                [name, email, hash, role, lat, lon, now]
            );
        };

        // CLIENT en La Rambla
        await insertUser('Cliente Rambla', 'rambla@demo.com', 'CLIENT', 41.3809, 2.1730);
        // DRIVER 1: ~0.7km de La Rambla
        await insertUser('Driver Uno', 'driver1@demo.com', 'DRIVER', 41.3870, 2.1700);
        // DRIVER 2: ~1.3km de La Rambla
        await insertUser('Driver Dos', 'driver2@demo.com', 'DRIVER', 41.3918, 2.1801);
        // DRIVER 3: ~8km (Badalona) – lejos
        await insertUser('Driver Tres', 'driver3@demo.com', 'DRIVER', 41.4500, 2.2450);

        console.error('[seed-bcn] Usuarios Barcelona creados:');
        console.error('  CLIENT  → rambla@demo.com  (lat: 41.3809, lon: 2.1730)');
        console.error('  DRIVER1 → driver1@demo.com (lat: 41.3870, lon: 2.1700) ~0.7km');
        console.error('  DRIVER2 → driver2@demo.com (lat: 41.3918, lon: 2.1801) ~1.3km');
        console.error('  DRIVER3 → driver3@demo.com (lat: 41.4500, lon: 2.2450) ~8km [FUERA]');
        console.error('\n[seed-bcn] Contraseña de todos: password123');
        console.error('[seed-bcn] Reinicia el servidor (npm run dev) para aplicar cambios.');
    } finally {
        client.release();
        await pool.end();
    }
}

main()
    .then(() => process.exit(0))
    .catch(err => { console.error('[seed-bcn] ERROR:', err); process.exit(1); });
