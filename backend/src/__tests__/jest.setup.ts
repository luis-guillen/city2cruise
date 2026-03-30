/**
 * Jest global setup: configura variables de entorno ANTES de importar módulos.
 * Esto se ejecuta ANTES de cada test suite.
 */

// Apuntar al pool de test (la DB de test se conecta aquí antes de que database.ts se importe)
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST
    || 'postgres://pablocabaleironoda@localhost:5432/cruise_connect_test';

// Evitar logs ruidosos en tests
process.env.LOG_LEVEL = 'silent';
