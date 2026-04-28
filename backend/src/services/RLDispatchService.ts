/**
 * RLDispatchService — Sprint 3.E
 *
 * Thin HTTP client that sends a StateTensor to the Python RL microservice
 * and returns a ranked list of driver IDs.
 *
 * Integration contract:
 *   • Call getRLDriverRanking() from the dispatch layer (GeoDispatchService or
 *     RequestService) BEFORE the geo-distance cascade.
 *   • If RL is disabled (RL_ROUTING_ENABLED != 'true') or the service times out,
 *     return an empty array — callers must always fall back to geo-distance.
 *   • The RL ranking is advisory; the caller decides whether to honour it.
 *
 * Feature flag:   RL_ROUTING_ENABLED=true
 * Service URL:    RL_SERVICE_URL=http://localhost:8080   (default)
 * Timeout:        RL_SERVICE_TIMEOUT_MS=2000             (default)
 */

import { config } from '../config/env';
import { logger } from '../utils/logger';
import { buildStateTensor, StateTensor } from './telemetry/StateFusion';

export interface DriverRanking {
    driverId: number;
    score: number;   // RL confidence [0,1]
    rank: number;    // 0 = highest confidence
}

interface RLAssignResponse {
    rankings: Array<{ driverId: number; score: number; rank: number; etaMs?: number }>;
    modelVersion: string;
    inferenceMs: number;
}

/**
 * Ask the RL microservice to rank available drivers for the current state.
 *
 * Returns an empty array (safe fallback) if:
 *   - RL routing is disabled via feature flag
 *   - The microservice is unreachable or exceeds the timeout
 *   - The response is malformed
 *
 * Never throws — errors are logged and swallowed so dispatch always proceeds.
 */
export async function getRLDriverRanking(
    tensor?: StateTensor,
): Promise<DriverRanking[]> {
    if (!config.rl.enabled) return [];

    try {
        const stateTensor = tensor ?? (await buildStateTensor());

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.rl.timeoutMs);

        let response: Response;
        try {
            response = await fetch(`${config.rl.serviceUrl}/assign`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ state: stateTensor }),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeoutId);
        }

        if (!response.ok) {
            logger.warn(
                { status: response.status, url: config.rl.serviceUrl },
                '[RL] /assign returned non-2xx — falling back to geo-distance',
            );
            return [];
        }

        const data = (await response.json()) as RLAssignResponse;

        if (!Array.isArray(data.rankings)) return [];

        logger.debug(
            { inferenceMs: data.inferenceMs, modelVersion: data.modelVersion, drivers: data.rankings.length },
            '[RL] Got driver ranking',
        );

        return data.rankings.map(r => ({
            driverId: r.driverId,
            score: r.score,
            rank: r.rank,
        }));
    } catch (err) {
        if ((err as Error).name === 'AbortError') {
            logger.warn({ timeoutMs: config.rl.timeoutMs }, '[RL] Service timeout — falling back to geo-distance');
        } else {
            logger.warn({ err }, '[RL] Service unreachable — falling back to geo-distance');
        }
        return [];
    }
}

/**
 * Reorder a list of candidate driver IDs according to the RL ranking.
 * Drivers absent from the RL response (e.g., newly connected) are appended
 * at the end in their original order so they are still considered.
 *
 * @param candidateIds   Driver IDs from the geo-distance cascade, closest first
 * @param rankings       Output of getRLDriverRanking()
 */
export function applyRLRanking(
    candidateIds: number[],
    rankings: DriverRanking[],
): number[] {
    if (rankings.length === 0) return candidateIds;

    const rankMap = new Map(rankings.map(r => [r.driverId, r.rank]));
    const inRanking = candidateIds.filter(id => rankMap.has(id));
    const notInRanking = candidateIds.filter(id => !rankMap.has(id));

    inRanking.sort((a, b) => (rankMap.get(a) ?? 999) - (rankMap.get(b) ?? 999));

    return [...inRanking, ...notInRanking];
}
