/**
 * Sprint 3.F.1 — RL Dispatch Latency & Resilience Tests
 *
 * AC#3 de Hito 3.5: el sistema RL nunca bloquea el dispatch.
 *
 *  Test 1 — fast response  : RL responde <50 ms → ranking se honra
 *  Test 2 — slow response  : RL tarda >timeout → fallback sin bloqueo
 *  Test 3 — 500 error      : RL devuelve 5xx → fallback, sin excepción
 *  Test 4 — malformed JSON : respuesta sin .rankings → fallback seguro
 *  Test 5 — applyRLRanking : reordena candidatos según RL, appends unknown
 */

// ── mock config before RLDispatchService is imported ──────────────────────
// config.rl.enabled is bound at module load time so env overrides in
// beforeAll arrive too late — we inject a controlled config object instead.

const mockConfig = {
    rl: {
        enabled: true,
        serviceUrl: 'http://localhost:8080',
        timeoutMs: 500,
    },
};

jest.mock('../config/env', () => ({ config: mockConfig }));

import { getRLDriverRanking, applyRLRanking } from '../services/RLDispatchService';

// ── fetch mock helpers ─────────────────────────────────────────────────────

function mockFetchOk(rankings: object[], delayMs = 0): jest.SpyInstance {
    return jest.spyOn(global, 'fetch').mockImplementation(async (_url, options) => {
        if (delayMs > 0) {
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(resolve, delayMs);
                const signal = (options as RequestInit | undefined)?.signal as AbortSignal | undefined;
                if (signal) {
                    signal.addEventListener('abort', () => {
                        clearTimeout(timer);
                        const err = new Error('The operation was aborted');
                        err.name = 'AbortError';
                        reject(err);
                    });
                }
            });
        }
        return {
            ok: true,
            status: 200,
            json: async () => ({ rankings, modelVersion: 'ppo-v1', inferenceMs: delayMs }),
        } as unknown as Response;
    });
}

function mockFetchError(status: number): jest.SpyInstance {
    return jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status,
        json: async () => ({}),
    } as unknown as Response);
}

function mockFetchMalformed(): jest.SpyInstance {
    return jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ result: 'unexpected_shape' }),
    } as unknown as Response);
}

// ── mock buildStateTensor so tests don't need a live DB ───────────────────

jest.mock('../services/telemetry/StateFusion', () => ({
    buildStateTensor: jest.fn().mockResolvedValue({ driverCount: 0, requestCount: 0 }),
}));

// ── Tests ──────────────────────────────────────────────────────────────────

describe('RL latency & resilience', () => {

    describe('Test 1 — fast response: ranking is honored', () => {
        it('returns rankings when RL service responds quickly', async () => {
            const rlRankings = [
                { driverId: 10, score: 0.95, rank: 0 },
                { driverId: 20, score: 0.80, rank: 1 },
                { driverId: 30, score: 0.60, rank: 2 },
            ];
            const spy = mockFetchOk(rlRankings, 20); // 20ms << 500ms timeout

            const start = Date.now();
            const result = await getRLDriverRanking();
            const elapsed = Date.now() - start;

            expect(result).toHaveLength(3);
            expect(result[0].driverId).toBe(10);
            expect(result[0].rank).toBe(0);
            expect(result[1].driverId).toBe(20);
            expect(elapsed).toBeLessThan(200);

            spy.mockRestore();
        });
    });

    describe('Test 2 — slow response (> timeout): fallback, no blocking', () => {
        it('returns [] within ~timeout ms when RL service is slow', async () => {
            // RL_SERVICE_TIMEOUT_MS=500, mock delays 1200ms → AbortError
            const spy = mockFetchOk([], 1200);

            const start = Date.now();
            const result = await getRLDriverRanking();
            const elapsed = Date.now() - start;

            expect(result).toEqual([]);
            // Should abort around 500ms, give 400ms slack for CI overhead
            expect(elapsed).toBeLessThan(900);

            spy.mockRestore();
        });
    });

    describe('Test 3 — 500 error: no exception, returns []', () => {
        it('returns [] without throwing when RL service returns 500', async () => {
            const spy = mockFetchError(500);

            await expect(getRLDriverRanking()).resolves.toEqual([]);

            spy.mockRestore();
        });
    });

    describe('Test 4 — malformed response: returns []', () => {
        it('returns [] when response has no .rankings array', async () => {
            const spy = mockFetchMalformed();

            await expect(getRLDriverRanking()).resolves.toEqual([]);

            spy.mockRestore();
        });
    });

    describe('Test 5 — RL disabled: skips fetch entirely', () => {
        it('returns [] immediately when rl.enabled is false', async () => {
            mockConfig.rl.enabled = false;

            const fetchSpy = jest.spyOn(global, 'fetch');
            const result = await getRLDriverRanking();

            expect(result).toEqual([]);
            expect(fetchSpy).not.toHaveBeenCalled();

            fetchSpy.mockRestore();
            mockConfig.rl.enabled = true; // restore for other tests
        });
    });
});

describe('applyRLRanking', () => {
    it('reorders candidates by RL rank (lower rank = higher priority)', () => {
        const candidates = [30, 10, 20];
        const rankings = [
            { driverId: 10, score: 0.95, rank: 0 },
            { driverId: 20, score: 0.80, rank: 1 },
            { driverId: 30, score: 0.60, rank: 2 },
        ];

        const result = applyRLRanking(candidates, rankings);

        expect(result).toEqual([10, 20, 30]);
    });

    it('appends drivers not in RL response at end, in original order', () => {
        const candidates = [99, 10, 77, 20];
        const rankings = [
            { driverId: 20, score: 0.90, rank: 0 },
            { driverId: 10, score: 0.70, rank: 1 },
        ];

        const result = applyRLRanking(candidates, rankings);

        expect(result[0]).toBe(20);
        expect(result[1]).toBe(10);
        // 99 and 77 appended, preserving their relative order
        expect(result.slice(2)).toEqual([99, 77]);
    });

    it('returns original order unchanged when rankings is empty', () => {
        const candidates = [1, 2, 3];
        expect(applyRLRanking(candidates, [])).toEqual([1, 2, 3]);
    });

    it('handles empty candidate list gracefully', () => {
        const rankings = [{ driverId: 10, score: 0.9, rank: 0 }];
        expect(applyRLRanking([], rankings)).toEqual([]);
    });
});
