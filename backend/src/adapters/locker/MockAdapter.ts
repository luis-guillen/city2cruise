import type { LockerHardwareAdapter, LockerHwStatus, LockerHealthReport } from './LockerHardwareAdapter';
import { logger } from '../../utils/logger';

/**
 * In-memory mock adapter for development and testing.
 * failRate (0-1) simulates hardware unreliability to exercise the circuit breaker.
 */
export class MockAdapter implements LockerHardwareAdapter {
    private states = new Map<string, LockerHwStatus>();
    private readonly failRate: number;

    constructor(failRate = 0) {
        this.failRate = failRate;
    }

    private maybeFailure(op: string, lockerId: string): void {
        if (Math.random() < this.failRate) {
            throw new Error(`[Mock] Simulated hardware error: ${op} on locker ${lockerId}`);
        }
    }

    async open(lockerId: string): Promise<void> {
        await new Promise((r) => setTimeout(r, 20)); // simulate I/O latency
        this.maybeFailure('open', lockerId);
        this.states.set(lockerId, 'UNLOCKED');
        logger.info({ lockerId }, '[Mock] Locker opened');
    }

    async close(lockerId: string): Promise<void> {
        await new Promise((r) => setTimeout(r, 20));
        this.maybeFailure('close', lockerId);
        this.states.set(lockerId, 'LOCKED');
        logger.info({ lockerId }, '[Mock] Locker closed');
    }

    async getStatus(lockerId: string): Promise<LockerHwStatus> {
        await new Promise((r) => setTimeout(r, 10));
        this.maybeFailure('getStatus', lockerId);
        return this.states.get(lockerId) ?? 'LOCKED';
    }

    async healthCheck(): Promise<LockerHealthReport> {
        return { online: true, lastSeen: new Date() };
    }
}
