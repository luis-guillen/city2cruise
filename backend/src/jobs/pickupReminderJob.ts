import { db } from '../db/database';
import { notifyPickupReminder } from '../services/NotificationService';
import { logger } from '../utils/logger';
import { config } from '../config/env';

export async function runPickupReminderJob(): Promise<void> {
    const thresholdHours = config.pickupReminderHours;

    const { rows } = await db.query(
        `SELECT r.id, r.client_id, l.label AS locker_label,
                EXTRACT(EPOCH FROM (NOW() - r.updated_at)) / 3600 AS hours_waiting
         FROM pickup_requests r
         JOIN lockers l ON r.locker_id = l.id
         WHERE r.status = 'DEPOSITED'
           AND r.updated_at < NOW() - INTERVAL '${thresholdHours} hours'`,
    );

    if (rows.length === 0) return;

    logger.info({ count: rows.length, thresholdHours }, 'Pickup reminder job: sending reminders');

    await Promise.all(rows.map((row: any) =>
        notifyPickupReminder(
            row.client_id,
            row.locker_label,
            Math.round(row.hours_waiting).toString(),
        ).catch((err) => logger.error({ err, requestId: row.id }, 'Reminder notification failed')),
    ));
}

// Interval handle — exported so server can clear it on shutdown
let _interval: NodeJS.Timeout | null = null;

export function startPickupReminderScheduler(): void {
    if (_interval) return;
    _interval = setInterval(runPickupReminderJob, 60 * 60 * 1000); // cada hora
    runPickupReminderJob().catch(() => {}); // primera ejecución inmediata
    logger.info({ intervalHours: 1 }, 'Pickup reminder scheduler started');
}

export function stopPickupReminderScheduler(): void {
    if (_interval) { clearInterval(_interval); _interval = null; }
}
