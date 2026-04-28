import { db } from '../db/database';
import { getLockerBreakers } from '../adapters/locker';
import { logLockerHwEvent } from './AuditService';
import { logger } from '../utils/logger';
import { config } from '../config/env';

const SYSTEM_ACTOR_ID = null; // null = automated/system event (actor_id is nullable in locker_hw_events)

// Track consecutive hardware failures per locker id
const consecutiveFailures = new Map<number, number>();

async function runSyncCycle(): Promise<void> {
    const { status: statusBreaker, health: healthBreaker } = getLockerBreakers();

    // 1. Hardware health-check (adapter-level)
    try {
        const report = await healthBreaker.fire();
        if (!report.online) {
            logger.warn({ errorCode: report.errorCode }, '[LockerSync] Hardware adapter reports OFFLINE');
        }
    } catch (err) {
        logger.error({ err }, '[LockerSync] Health check failed');
    }

    // 2. Per-locker state reconciliation
    const { rows: lockers } = await db.query<{
        id: number;
        label: string;
        is_occupied: boolean;
        hw_status: string;
    }>("SELECT id, label, is_occupied, hw_status FROM lockers WHERE hw_status != 'OUT_OF_SERVICE'");

    for (const locker of lockers) {
        try {
            const hwStatus = await statusBreaker.fire(String(locker.id));

            // Discrepancy: DB says occupied (locked) but HW reports UNLOCKED — or vice versa
            const dbExpectsLocked = locker.is_occupied; // occupied → should be LOCKED (door secured)
            if (dbExpectsLocked && hwStatus === 'UNLOCKED') {
                logger.warn(
                    { lockerId: locker.id, label: locker.label, dbOccupied: true, hwStatus },
                    '[LockerSync] Discrepancy: DB=occupied but HW=UNLOCKED',
                );
            } else if (!dbExpectsLocked && hwStatus === 'UNLOCKED') {
                logger.warn(
                    { lockerId: locker.id, label: locker.label, dbOccupied: false, hwStatus },
                    '[LockerSync] Discrepancy: DB=free but HW=UNLOCKED (door may be ajar)',
                );
            }

            // Reset failure count on success and update sync timestamp
            consecutiveFailures.set(locker.id, 0);
            await db.query('UPDATE lockers SET last_sync_at = NOW() WHERE id = $1', [locker.id]);
        } catch (err) {
            const count = (consecutiveFailures.get(locker.id) ?? 0) + 1;
            consecutiveFailures.set(locker.id, count);

            logger.error(
                { err, lockerId: locker.id, label: locker.label, consecutiveFailures: count },
                '[LockerSync] Hardware status check failed',
            );

            if (count >= config.locker.outOfServiceThreshold) {
                await db.query(
                    "UPDATE lockers SET hw_status = 'OUT_OF_SERVICE', updated_at = NOW() WHERE id = $1",
                    [locker.id],
                );
                consecutiveFailures.delete(locker.id);

                logger.error(
                    { lockerId: locker.id, label: locker.label },
                    '[LockerSync] Locker marked OUT_OF_SERVICE after repeated failures',
                );

                logLockerHwEvent({
                    lockerId: locker.id,
                    eventType: 'MARKED_OUT_OF_SERVICE',
                    actorId: SYSTEM_ACTOR_ID,
                    metadata: { reason: 'consecutive_hw_failures', count },
                }).catch(() => {});
            }
        }
    }
}

let _interval: NodeJS.Timeout | null = null;

export function startLockerSync(): void {
    if (_interval) return;
    _interval = setInterval(runSyncCycle, config.locker.syncIntervalMs);
    runSyncCycle().catch(() => {});
    logger.info({ intervalMs: config.locker.syncIntervalMs }, 'Locker sync scheduler started');
}

export function stopLockerSync(): void {
    if (_interval) {
        clearInterval(_interval);
        _interval = null;
    }
}
