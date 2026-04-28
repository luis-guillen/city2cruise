import CircuitBreaker from 'opossum';
import { logger } from '../../utils/logger';

export interface BreakerOptions {
    name: string;
    timeoutMs?: number;
    errorThresholdPct?: number;
    resetTimeoutMs?: number;
}

/**
 * Creates an opossum circuit breaker wrapping an async function.
 * Logs state transitions so operators can spot hardware degradation.
 */
export function createLockerBreaker<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => Promise<TResult>,
    opts: BreakerOptions,
): CircuitBreaker<TArgs, TResult> {
    const breaker = new CircuitBreaker(fn, {
        name: opts.name,
        timeout: opts.timeoutMs ?? 5000,
        errorThresholdPercentage: opts.errorThresholdPct ?? 50,
        resetTimeout: opts.resetTimeoutMs ?? 30_000,
        rollingCountTimeout: 10_000,
        rollingCountBuckets: 10,
    });

    breaker.on('open', () =>
        logger.warn({ breaker: opts.name }, 'Circuit breaker OPEN — hardware calls suspended'),
    );
    breaker.on('halfOpen', () =>
        logger.info({ breaker: opts.name }, 'Circuit breaker HALF-OPEN — testing recovery'),
    );
    breaker.on('close', () =>
        logger.info({ breaker: opts.name }, 'Circuit breaker CLOSED — hardware calls resumed'),
    );
    breaker.fallback(() => {
        throw new Error(`Locker hardware unavailable (circuit open): ${opts.name}`);
    });

    return breaker;
}
