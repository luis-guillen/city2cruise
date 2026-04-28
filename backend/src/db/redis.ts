import Redis from 'ioredis';
import { logger } from '../utils/logger';

let _client: Redis | null = null;

/**
 * Returns a lazy Redis singleton or null when REDIS_URL is unset.
 * Callers must handle null gracefully (cache-bypass fallback).
 */
export function getRedisClient(): Redis | null {
    if (!process.env.REDIS_URL) return null;

    if (!_client) {
        _client = new Redis(process.env.REDIS_URL, {
            maxRetriesPerRequest: 1,
            lazyConnect: true,
            enableOfflineQueue: false,
            connectTimeout: 3000,
        });

        _client.on('error', (err) => {
            logger.warn({ err }, 'Redis connection error — cache disabled until reconnect');
        });

        _client.on('connect', () => {
            logger.info('Redis connected');
        });
    }

    return _client;
}

export async function closeRedis(): Promise<void> {
    if (_client) {
        await _client.quit();
        _client = null;
    }
}
