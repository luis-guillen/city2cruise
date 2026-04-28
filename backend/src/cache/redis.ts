import Redis, { type RedisOptions } from 'ioredis';
import { logger } from '../utils/logger';

/**
 * Hito 4.3.2 — Cliente Redis singleton con feature flag.
 *
 * Si REDIS_URL esta definida, instancia un cliente ioredis y lo expone.
 * Si no, devuelve null y los modulos consumidores deben hacer fallback
 * a su comportamiento single-process (memoria local). Esto permite seguir
 * desarrollando sin Redis y activarlo en produccion sin tocar codigo.
 *
 * Tambien expone clones para pub/sub, ya que ioredis exige conexiones
 * separadas para cmds normales y subscriptions.
 */
const REDIS_URL = process.env.REDIS_URL;

const baseOptions: RedisOptions = {
  // En tests no queremos que se quede colgado intentando reconectar.
  maxRetriesPerRequest: process.env.NODE_ENV === 'test' ? 1 : 20,
  enableReadyCheck: true,
  lazyConnect: true,
};

let _client: Redis | null = null;
let _pub: Redis | null = null;
let _sub: Redis | null = null;

export function getRedis(): Redis | null {
  if (!REDIS_URL) return null;
  if (!_client) {
    _client = new Redis(REDIS_URL, baseOptions);
    _client.on('error', (e) =>
      logger.warn({ err: e.message }, 'redis client error'),
    );
    _client.on('connect', () => logger.info('redis connected'));
    _client.connect().catch(() => {
      // no-op: el caller hara fallback si la conexion falla.
    });
  }
  return _client;
}

export function getRedisPubSub(): { pub: Redis; sub: Redis } | null {
  if (!REDIS_URL) return null;
  if (!_pub) {
    _pub = new Redis(REDIS_URL, baseOptions);
    _pub.connect().catch(() => {});
  }
  if (!_sub) {
    _sub = new Redis(REDIS_URL, baseOptions);
    _sub.connect().catch(() => {});
  }
  return { pub: _pub, sub: _sub };
}

export async function closeRedis(): Promise<void> {
  await Promise.all(
    [_client, _pub, _sub]
      .filter(Boolean)
      .map((c) => c!.quit().catch(() => {})),
  );
  _client = _pub = _sub = null;
}
