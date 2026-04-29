/**
 * Hito H-2.1 (S-06) — Política CORS endurecida.
 *
 * Verifica:
 *   - Origen no incluido en la whitelist NO recibe cabecera
 *     Access-Control-Allow-Origin (rechazo).
 *   - Origen en la whitelist (config.frontendUrl o ALLOWED_ORIGINS) la recibe.
 *   - localhost:* y 192.168.* sólo en dev.
 *
 * El test monta sólo el middleware CORS y un endpoint dummy: no toca DB.
 */

import express, { Express } from 'express';
import cors from 'cors';
import request from 'supertest';

// Usaremos config sólo para reflejar los orígenes por defecto que el server
// real expone. Aislamos el módulo para evitar dotenv leak entre suites.
let config: typeof import('../config/env').config;
beforeAll(() => {
    jest.isolateModules(() => {
        process.env.NODE_ENV = 'test';
        process.env.ALLOWED_ORIGINS = 'http://localhost:9100,http://localhost:9101';
        config = require('../config/env').config;
    });
});

const buildCorsApp = (envOverride?: string): Express => {
    const app = express();
    const allow = new Set<string>([config.frontendUrl, ...config.allowedOrigins]);
    const localPortRegex = /^http:\/\/localhost:(\d{4,5})$/;
    const lanRegex = /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/;
    const env = envOverride ?? process.env.NODE_ENV;

    app.use(
        cors({
            credentials: true,
            origin(origin, callback) {
                if (!origin) return callback(null, true);
                if (allow.has(origin)) return callback(null, true);
                if (env !== 'production' && localPortRegex.test(origin)) return callback(null, true);
                if (env !== 'production' && lanRegex.test(origin)) return callback(null, true);
                return callback(new Error('Not allowed by CORS'));
            },
        }),
    );
    app.get('/health', (_req, res) => res.json({ ok: true }));
    return app;
};

describe('Hito H-2.1 — CORS hardening', () => {
    test('rechaza origin foráneo (no debe propagar Access-Control-Allow-Origin)', async () => {
        const app = buildCorsApp();
        const res = await request(app)
            .get('/health')
            .set('Origin', 'https://attacker.example');
        // Cuando cors() rechaza, NO añade la cabecera; supertest puede ver el
        // request 200 igualmente porque el middleware no aborta el request en
        // GET, simplemente no autoriza el browser.
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    test('acepta origin en la whitelist (config.frontendUrl)', async () => {
        const app = buildCorsApp();
        const res = await request(app)
            .get('/health')
            .set('Origin', config.frontendUrl);
        expect(res.headers['access-control-allow-origin']).toBe(config.frontendUrl);
    });

    test('acepta origin de ALLOWED_ORIGINS', async () => {
        const app = buildCorsApp();
        const res = await request(app)
            .get('/health')
            .set('Origin', 'http://localhost:9101');
        expect(res.headers['access-control-allow-origin']).toBe('http://localhost:9101');
    });

    test('en dev, localhost:* y 192.168.* son aceptados por regex', async () => {
        const app = buildCorsApp('development');
        const r1 = await request(app).get('/health').set('Origin', 'http://localhost:5173');
        expect(r1.headers['access-control-allow-origin']).toBe('http://localhost:5173');

        const r2 = await request(app).get('/health').set('Origin', 'http://192.168.1.10:9100');
        expect(r2.headers['access-control-allow-origin']).toBe('http://192.168.1.10:9100');
    });

    test('en producción, localhost:* y 192.168.* son rechazados', async () => {
        const app = buildCorsApp('production');
        const r1 = await request(app).get('/health').set('Origin', 'http://localhost:5173');
        expect(r1.headers['access-control-allow-origin']).toBeUndefined();

        const r2 = await request(app).get('/health').set('Origin', 'http://192.168.1.10:9100');
        expect(r2.headers['access-control-allow-origin']).toBeUndefined();
    });
});
