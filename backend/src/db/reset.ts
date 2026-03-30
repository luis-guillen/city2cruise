/**
 * Reset script: Reinicializa la base de datos PostgreSQL.
 * Elimina todas las tablas y recrea el esquema + seed.
 *
 * Uso: npm run db:reset
 */
import { pool, initDB } from './database';

async function main() {
    console.log('[Reset] Iniciando reseteo de la base de datos...');

    const client = await pool.connect();
    try {
        // Eliminar y recrear schema (borra TODAS las tablas)
        await client.query('DROP SCHEMA public CASCADE');
        await client.query('CREATE SCHEMA public');
        console.log('[Reset] Schema público recreado.');

        // Reinicializar (creará tablas y ejecutará seeder)
        await initDB();
        console.log('[Reset] Base de datos regenerada con éxito.');
    } finally {
        client.release();
        await pool.end();
    }
}

main()
    .then(() => process.exit(0))
    .catch(err => { console.error('[Reset] Error al resetear DB:', err); process.exit(1); });
