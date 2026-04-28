import { getRedis } from './redis';
import { logger } from '../utils/logger';

/**
 * Hito 4.3.2 — Cache abstraction con fallback a memoria.
 *
 * Si hay Redis, usa Redis con TTL. Si no, usa Map en memoria
 * con TTL emulado (limpieza perezosa al leer).
 *
 * Uso tipico: cachear listados poco volatiles (lockers, configuracion)
 * para evitar hits a Postgres.
 */
type CacheEntry<T> = { value: T; expiresAt: number };
const memory = new Map<string, CacheEntry<unknown>>();

export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (redis && redis.status === 'ready') {
    try {
      const raw = await redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (e) {
      logger.warn({ key, err: (e as Error).message }, 'cache.get redis fail, falling back');
    }
  }
  const e = memory.get(key) as CacheEntry<T> | undefined;
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    memory.delete(key);
    return null;
  }
  return e.value;
}

export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const redis = getRedis();
  if (redis && redis.status === 'ready') {
    try {
      await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      return;
    } catch (e) {
      logger.warn({ key, err: (e as Error).message }, 'cache.set redis fail, falling back');
    }
  }
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function cacheDel(key: string): Promise<void> {
  const redis = getRedis();
  if (redis && redis.status === 'ready') {
    try {
      await redis.del(key);
    } catch {
      /* ignore */
    }
  }
  memory.delete(key);
}

export async function cacheGetOrSet<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;
  const value = await loader();
  await cacheSet(key, value, ttlSeconds);
  return value;
}

/** Para tests: vacia el storage en memoria */
export function _clearMemoryCache(): void {
  memory.clear();
}
