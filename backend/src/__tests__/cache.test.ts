/**
 * Hito 4.3.2 — Test del cache abstraction (modo memoria, sin Redis).
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { cacheGet, cacheSet, cacheDel, cacheGetOrSet, _clearMemoryCache } from '../cache/cache';

describe('Hito 4.3.2 — cache abstraction (memory mode)', () => {
  beforeEach(() => {
    delete process.env.REDIS_URL;
    _clearMemoryCache();
  });

  it('cacheSet / cacheGet round trip', async () => {
    await cacheSet('k1', { foo: 1 }, 60);
    const v = await cacheGet<{ foo: number }>('k1');
    expect(v).toEqual({ foo: 1 });
  });

  it('respeta TTL: tras expirar devuelve null', async () => {
    await cacheSet('k2', 'x', 0);
    // 0 segundos -> expira inmediatamente; agregamos 1ms para garantizar
    await new Promise((r) => setTimeout(r, 5));
    expect(await cacheGet('k2')).toBeNull();
  });

  it('cacheDel borra la entrada', async () => {
    await cacheSet('k3', 'y', 60);
    await cacheDel('k3');
    expect(await cacheGet('k3')).toBeNull();
  });

  it('cacheGetOrSet: ejecuta loader la primera vez y reutiliza la segunda', async () => {
    let calls = 0;
    const loader = async () => {
      calls++;
      return { n: calls };
    };
    const a = await cacheGetOrSet('k4', 60, loader);
    const b = await cacheGetOrSet('k4', 60, loader);
    expect(a).toEqual({ n: 1 });
    expect(b).toEqual({ n: 1 });
    expect(calls).toBe(1);
  });
});
