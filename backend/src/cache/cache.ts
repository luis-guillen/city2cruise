import { getRedisClient } from '../db/redis';
import { logger } from '../utils/logger';

/**
 * Cache-Aside helper.
 *
 * Tries Redis first; on miss calls `fn()`, stores the result, then returns it.
 * Degrades transparently to no-cache when Redis is unavailable.
 *
 * @param key        Redis key
 * @param ttlSeconds Expiry in seconds (use 0 for no expiry)
 * @param fn         Source-of-truth query to run on cache miss
 */
export async function withCache<T>(
    key: string,
    ttlSeconds: number,
    fn: () => Promise<T>,
): Promise<T> {
    const redis = getRedisClient();

    if (redis) {
        try {
            const raw = await redis.get(key);
            if (raw !== null) {
                return JSON.parse(raw) as T;
            }
        } catch (err) {
            logger.warn({ err, key }, 'Redis GET failed — cache bypassed');
        }
    }

    const result = await fn();

    if (redis && ttlSeconds > 0) {
        try {
            await redis.setex(key, ttlSeconds, JSON.stringify(result));
        } catch (err) {
            logger.warn({ err, key }, 'Redis SET failed — result not cached');
        }
    }

    return result;
}

/**
 * Evict one or more cache keys (call after mutations that invalidate cached data).
 */
export async function invalidateCache(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const redis = getRedisClient();
    if (!redis) return;
    try {
        await redis.del(...keys);
    } catch (err) {
        logger.warn({ err, keys }, 'Redis DEL failed');
    }
}
