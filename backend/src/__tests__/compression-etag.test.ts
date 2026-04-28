/**
 * Hito 4.3.4 — Test de compresion gzip/brotli + ETag.
 *
 * Levanta una app Express MINIMA (sin DB) que reusa el middleware de
 * compression igual que server.ts y verifica:
 *  - Respuesta >1KB es gzipped por defecto.
 *  - X-No-Compression la desactiva.
 *  - ETag fuerte presente.
 *  - 304 Not Modified cuando se reenvia con If-None-Match.
 */
import { describe, it, expect } from '@jest/globals';
import express from 'express';
import compression from 'compression';
import request from 'supertest';

function buildApp() {
  const app = express();
  app.use(
    compression({
      threshold: 1024,
      filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        return compression.filter(req, res);
      },
    }),
  );
  app.set('etag', 'strong');
  app.get('/big', (_req, res) => {
    // 4 KB payload (texto repetido)
    res.json({ data: 'lorem ipsum '.repeat(400) });
  });
  app.get('/small', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('Hito 4.3.4 — compression + ETag', () => {
  const app = buildApp();

  it('respuesta grande llega comprimida con gzip por defecto', async () => {
    const res = await request(app)
      .get('/big')
      .set('Accept-Encoding', 'gzip')
      .expect(200);
    expect(res.headers['content-encoding']).toBe('gzip');
  });

  it('X-No-Compression desactiva gzip', async () => {
    const res = await request(app)
      .get('/big')
      .set('Accept-Encoding', 'gzip')
      .set('x-no-compression', '1')
      .expect(200);
    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('respuesta pequena (<1KB) NO se comprime (threshold)', async () => {
    const res = await request(app)
      .get('/small')
      .set('Accept-Encoding', 'gzip')
      .expect(200);
    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('ETag fuerte presente en /small', async () => {
    const res = await request(app).get('/small').expect(200);
    expect(res.headers.etag).toBeDefined();
    // ETag fuerte no empieza por W/
    expect(res.headers.etag.startsWith('W/')).toBe(false);
  });

  it('reenviar con If-None-Match devuelve 304', async () => {
    const first = await request(app).get('/small').expect(200);
    const etag = first.headers.etag;
    expect(etag).toBeDefined();
    await request(app).get('/small').set('If-None-Match', etag).expect(304);
  });
});
