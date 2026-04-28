import webpush from 'web-push';
import twilio from 'twilio';
import { db } from '../db/database';
import { config } from '../config/env';
import { logger } from '../utils/logger';

// ── VAPID setup ───────────────────────────────────────────────────────────────
webpush.setVapidDetails(
    config.vapid.subject,
    config.vapid.publicKey,
    config.vapid.privateKey,
);

// ── Twilio client (lazy — only if credentials present) ───────────────────────
let twilioClient: ReturnType<typeof twilio> | null = null;
function getTwilio() {
    if (!twilioClient && config.twilio.accountSid && config.twilio.authToken) {
        twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
    }
    return twilioClient;
}

// ── Supported notification keys ───────────────────────────────────────────────
export type NotificationKey =
    | 'handshake_otp'
    | 'deposit_ready'
    | 'pickup_reminder'
    | 'request_assigned'
    | 'request_updated';

type Locale = 'es' | 'en' | 'ca';

// ── Fallback templates (used when DB templates are missing) ───────────────────
const BUILTIN_TEMPLATES: Record<NotificationKey, Record<Locale, { title: string; body: string }>> = {
    handshake_otp: {
        es: { title: 'Código de verificación', body: 'Tu código de entrega City2Cruise es: {{code}}. Válido 5 minutos.' },
        en: { title: 'Verification code', body: 'Your City2Cruise delivery code is: {{code}}. Valid for 5 minutes.' },
        ca: { title: 'Codi de verificació', body: 'El teu codi de lliurament City2Cruise és: {{code}}. Vàlid 5 minuts.' },
    },
    deposit_ready: {
        es: { title: '¡Tu paquete está en el locker!', body: 'Locker {{locker}}. Código PIN: {{code}}. Expira hoy a medianoche.' },
        en: { title: 'Your package is in the locker!', body: 'Locker {{locker}}. PIN: {{code}}. Expires tonight at midnight.' },
        ca: { title: 'El teu paquet és al locker!', body: 'Locker {{locker}}. Codi PIN: {{code}}. Expira avui a mitjanit.' },
    },
    pickup_reminder: {
        es: { title: 'Recordatorio: paquete pendiente', body: 'Tienes un paquete en el locker {{locker}} que lleva más de {{hours}} horas esperando.' },
        en: { title: 'Reminder: pending package', body: 'You have a package in locker {{locker}} waiting for over {{hours}} hours.' },
        ca: { title: 'Recordatori: paquet pendent', body: 'Tens un paquet al locker {{locker}} esperant més de {{hours}} hores.' },
    },
    request_assigned: {
        es: { title: 'Conductor en camino', body: 'Un conductor ha aceptado tu solicitud y está en camino.' },
        en: { title: 'Driver on the way', body: 'A driver has accepted your request and is heading to you.' },
        ca: { title: 'Conductor en camí', body: 'Un conductor ha acceptat la teva sol·licitud i s\'acosta.' },
    },
    request_updated: {
        es: { title: 'Solicitud actualizada', body: 'El estado de tu solicitud ha cambiado.' },
        en: { title: 'Request updated', body: 'Your request status has changed.' },
        ca: { title: 'Sol·licitud actualitzada', body: 'L\'estat de la teva sol·licitud ha canviat.' },
    },
};

function interpolate(template: string, vars: Record<string, string>): string {
    return Object.entries(vars).reduce(
        (str, [k, v]) => str.replaceAll(`{{${k}}}`, v),
        template,
    );
}

// ── Fetch user prefs + subscriptions ─────────────────────────────────────────
async function getUserContext(userId: number) {
    const { rows: [prefs] } = await db.query(
        `SELECT push_enabled, sms_enabled, locale, phone
         FROM user_notification_prefs WHERE user_id = $1`,
        [userId],
    );
    const { rows: subs } = await db.query(
        `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
        [userId],
    );
    return {
        pushEnabled: prefs?.push_enabled ?? true,
        smsEnabled: prefs?.sms_enabled ?? true,
        locale: (prefs?.locale ?? 'es') as Locale,
        phone: prefs?.phone ?? null as string | null,
        subscriptions: subs as Array<{ endpoint: string; p256dh: string; auth: string }>,
    };
}

// ── Resolve template from DB or fallback ─────────────────────────────────────
async function resolveTemplate(
    key: NotificationKey,
    locale: Locale,
    vars: Record<string, string>,
): Promise<{ title: string; body: string }> {
    const { rows: [row] } = await db.query(
        `SELECT title, body FROM notification_templates
         WHERE key = $1 AND locale = $2 AND active = TRUE
         ORDER BY created_at DESC LIMIT 1`,
        [key, locale],
    );

    const raw = row ?? BUILTIN_TEMPLATES[key][locale] ?? BUILTIN_TEMPLATES[key]['es'];
    return {
        title: interpolate(raw.title, vars),
        body: interpolate(raw.body, vars),
    };
}

// ── Send Web Push to all active subscriptions ─────────────────────────────────
async function sendPush(
    userId: number,
    subscriptions: Array<{ endpoint: string; p256dh: string; auth: string }>,
    title: string,
    body: string,
    data?: Record<string, unknown>,
): Promise<boolean> {
    if (subscriptions.length === 0) return false;

    const payload = JSON.stringify({ title, body, ...data });
    const staleEndpoints: string[] = [];
    let sent = false;

    await Promise.all(subscriptions.map(async (sub) => {
        try {
            await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                payload,
            );
            sent = true;
        } catch (err: any) {
            if (err.statusCode === 410 || err.statusCode === 404) {
                // Subscription expired or gone — remove it
                staleEndpoints.push(sub.endpoint);
            } else {
                logger.warn({ userId, endpoint: sub.endpoint.slice(0, 40), err: err.message }, 'Push send error');
            }
        }
    }));

    if (staleEndpoints.length > 0) {
        await db.query(
            `DELETE FROM push_subscriptions WHERE endpoint = ANY($1)`,
            [staleEndpoints],
        );
        logger.info({ userId, removed: staleEndpoints.length }, 'Removed stale push subscriptions');
    }

    return sent;
}

// ── Send SMS via Twilio ───────────────────────────────────────────────────────
async function sendSms(phone: string, body: string): Promise<boolean> {
    const client = getTwilio();
    if (!client || !config.twilio.fromNumber) {
        logger.warn({ phone: phone.slice(0, 6) + '***' }, 'SMS not sent: Twilio not configured');
        return false;
    }
    try {
        await client.messages.create({ body, from: config.twilio.fromNumber, to: phone });
        return true;
    } catch (err: any) {
        logger.error({ err: err.message, phone: phone.slice(0, 6) + '***' }, 'Twilio SMS error');
        return false;
    }
}

// ── PUBLIC: core notification dispatcher ──────────────────────────────────────
export async function notify(params: {
    userId: number;
    key: NotificationKey;
    vars?: Record<string, string>;
    data?: Record<string, unknown>;
}): Promise<void> {
    const { userId, key, vars = {}, data } = params;

    try {
        const ctx = await getUserContext(userId);
        const { title, body } = await resolveTemplate(key, ctx.locale, vars);

        let delivered = false;

        // 1. Try Push first
        if (ctx.pushEnabled && ctx.subscriptions.length > 0) {
            delivered = await sendPush(userId, ctx.subscriptions, title, body, data);
        }

        // 2. SMS fallback (or as supplement for OTP — always via SMS if phone available)
        const alwaysSms = key === 'handshake_otp' || key === 'deposit_ready';
        if (ctx.smsEnabled && ctx.phone && (!delivered || alwaysSms)) {
            await sendSms(ctx.phone, `${title}\n${body}`);
        }

        // 3. Always store in notifications table for in-app bell
        await db.query(
            `INSERT INTO notifications (user_id, type, title, message)
             VALUES ($1, $2, $3, $4)`,
            [userId, key.toUpperCase(), title, body],
        );

        logger.info({ userId, key, push: delivered, sms: ctx.smsEnabled && !!ctx.phone }, 'Notification dispatched');
    } catch (err) {
        logger.error({ err, userId, key }, 'NotificationService error');
    }
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

export async function notifyHandshakeOtp(userId: number, code: string): Promise<void> {
    await notify({ userId, key: 'handshake_otp', vars: { code } });
}

export async function notifyDepositReady(userId: number, locker: string, code: string): Promise<void> {
    await notify({ userId, key: 'deposit_ready', vars: { locker, code }, data: { locker, code } });
}

export async function notifyPickupReminder(userId: number, locker: string, hours: string): Promise<void> {
    await notify({ userId, key: 'pickup_reminder', vars: { locker, hours } });
}

export async function notifyRequestAssigned(userId: number): Promise<void> {
    await notify({ userId, key: 'request_assigned' });
}

// ── Push subscription management ─────────────────────────────────────────────

export async function saveSubscription(userId: number, sub: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
}): Promise<void> {
    await db.query(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
        [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth],
    );
    logger.info({ userId }, 'Push subscription saved');
}

export async function removeSubscription(endpoint: string): Promise<void> {
    await db.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
}

export async function getPrefs(userId: number) {
    const { rows: [prefs] } = await db.query(
        `SELECT push_enabled, sms_enabled, locale, phone
         FROM user_notification_prefs WHERE user_id = $1`,
        [userId],
    );
    return prefs ?? { push_enabled: true, sms_enabled: true, locale: 'es', phone: null };
}

export async function upsertPrefs(userId: number, prefs: {
    pushEnabled?: boolean;
    smsEnabled?: boolean;
    locale?: 'es' | 'en' | 'ca';
    phone?: string | null;
}): Promise<void> {
    await db.query(
        `INSERT INTO user_notification_prefs (user_id, push_enabled, sms_enabled, locale, phone, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id) DO UPDATE
         SET push_enabled = COALESCE(EXCLUDED.push_enabled, user_notification_prefs.push_enabled),
             sms_enabled  = COALESCE(EXCLUDED.sms_enabled,  user_notification_prefs.sms_enabled),
             locale       = COALESCE(EXCLUDED.locale,        user_notification_prefs.locale),
             phone        = COALESCE(EXCLUDED.phone,         user_notification_prefs.phone),
             updated_at   = NOW()`,
        [userId, prefs.pushEnabled ?? null, prefs.smsEnabled ?? null, prefs.locale ?? null, prefs.phone ?? null],
    );
}

// Export VAPID public key for the frontend
export const vapidPublicKey = config.vapid.publicKey;
