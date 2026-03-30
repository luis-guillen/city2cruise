/**
 * Seed script: Escenario controlado de Las Palmas de Gran Canaria
 * Genera usuarios con coordenadas reales de la zona portuaria y lockers
 * con nombres de puntos estratégicos del puerto.
 *
 * Uso: npm run seed-lp
 */
import { pool, initDB } from './database';

async function main() {
    console.log('[seed-lp] Iniciando escenario Las Palmas de Gran Canaria...');

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

        const insertLocker = async (label: string) => {
            await client.query(
                'INSERT INTO lockers (label, is_occupied, updated_at) VALUES ($1, FALSE, $2) ON CONFLICT (label) DO NOTHING',
                [label, now]
            );
        };

        // ADMIN
        await insertUser('Admin LP', 'admin@city2cruise.com', 'ADMIN', null, null);
        // CLIENT cerca de Parque Santa Catalina
        await insertUser('Cliente Santa Catalina', 'cliente@demo.com', 'CLIENT', 28.1413, -15.4308);
        // DRIVER 1: Puerto de La Luz (~0.6km del cliente)
        await insertUser('Driver Puerto Luz', 'driver1@demo.com', 'DRIVER', 28.1468, -15.4170);
        // DRIVER 2: Muelle de Santa Catalina (~0.3km del cliente)
        await insertUser('Driver Muelle', 'driver2@demo.com', 'DRIVER', 28.1445, -15.4265);
        // DRIVER 3: Guanarteme (~2km del cliente)
        await insertUser('Driver Guanarteme', 'driver3@demo.com', 'DRIVER', 28.1260, -15.4440);

        // LOCKERS en zonas portuarias de Las Palmas
        await insertLocker('LP-PUERTO-01');
        await insertLocker('LP-PUERTO-02');
        await insertLocker('LP-PARQUE-01');
        await insertLocker('LP-TRIANA-01');
        await insertLocker('LP-CANTERAS-01');

        console.log('[seed-lp] Datos creados:');
        console.log('');
        console.log('  USUARIOS:');
        console.log('  ADMIN   → admin@city2cruise.com');
        console.log('  CLIENT  → cliente@demo.com      (Parque Santa Catalina: 28.1413, -15.4308)');
        console.log('  DRIVER1 → driver1@demo.com      (Puerto de La Luz:      28.1468, -15.4170) ~0.6km');
        console.log('  DRIVER2 → driver2@demo.com      (Muelle Santa Catalina: 28.1445, -15.4265) ~0.3km');
        console.log('  DRIVER3 → driver3@demo.com      (Guanarteme:            28.1260, -15.4440) ~2km');
        console.log('');
        console.log('  LOCKERS:');
        console.log('  LP-PUERTO-01  · Terminal de cruceros, Muelle Santa Catalina');
        console.log('  LP-PUERTO-02  · Muelle de La Luz');
        console.log('  LP-PARQUE-01  · Parque Santa Catalina');
        console.log('  LP-TRIANA-01  · Zona comercial Triana');
        console.log('  LP-CANTERAS-01 · Playa de Las Canteras');
        console.log('');
        console.log('  Contraseña de todos: password123');
        console.log('[seed-lp] Reinicia el servidor (npm run dev) para aplicar cambios.');
    } finally {
        client.release();
        await pool.end();
    }
}

main()
    .then(() => process.exit(0))
    .catch(err => { console.error('[seed-lp] ERROR:', err); process.exit(1); });
