import dotenv from 'dotenv';
import path from 'path';

// Cargar variables de entorno desde .env
dotenv.config();

export const config = {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '9000', 10),
    databaseUrl: process.env.DATABASE_URL || 'postgres://cruise:cruise_secret@localhost:5432/cruise_connect',
    jwtSecret: (() => {
        const secret = process.env.JWT_SECRET;
        if (!secret && process.env.NODE_ENV === 'production') {
            throw new Error('FATAL: JWT_SECRET es obligatorio en producción. Define la variable de entorno.');
        }
        return secret || 'secret_para_desarrollo_cambiar_en_produccion';
    })(),
    refreshTokenSecret: (() => {
        const secret = process.env.REFRESH_TOKEN_SECRET;
        if (!secret && process.env.NODE_ENV === 'production') {
            throw new Error('FATAL: REFRESH_TOKEN_SECRET es obligatorio en producción.');
        }
        return secret || 'refresh_secret_para_desarrollo_cambiar_en_produccion';
    })(),
    accessTokenExpirySeconds: parseInt(process.env.ACCESS_TOKEN_EXPIRY_SECONDS || '900', 10),
    refreshTokenExpiryDays: parseInt(process.env.REFRESH_TOKEN_EXPIRY_DAYS || '7', 10),
    loginMaxFailures: parseInt(process.env.LOGIN_MAX_FAILURES || '5', 10),
    gpsProximityMaxMeters: parseInt(process.env.GPS_PROXIMITY_MAX_METERS || '100', 10),
    gpsSpeedMaxKmh: parseInt(process.env.GPS_SPEED_MAX_KMH || '200', 10),
    gpsClockDriftMaxSec: parseInt(process.env.GPS_CLOCK_DRIFT_MAX_SEC || '30', 10),
    fieldEncryptionKey: (() => {
        const key = process.env.FIELD_ENCRYPTION_KEY || 'dev_key_32bytes_change_in_prod!!';
        if (key === 'dev_key_32bytes_change_in_prod!!' && process.env.NODE_ENV === 'production') {
            throw new Error('FATAL: FIELD_ENCRYPTION_KEY es obligatorio en producción.');
        }
        return key;
    })(),
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:9100',
    simulateRace: process.env.SIMULATE_RACE === 'true',
    searchRadii: [3, 5, 7] as const,   // km: cascade 3km → 5km → 7km
    cascadeTimeout: 17_000,             // ms between each cascade phase (17s for demo)
    SERVICE_AREA_NAME: process.env.SERVICE_AREA_NAME || 'Las Palmas',
    SERVICE_AREA_CENTER_LAT: parseFloat(process.env.SERVICE_AREA_CENTER_LAT || '28.1235'),
    SERVICE_AREA_CENTER_LON: parseFloat(process.env.SERVICE_AREA_CENTER_LON || '-15.4363'),
    SERVICE_AREA_SCOPE: process.env.SERVICE_AREA_SCOPE || 'Las Palmas de Gran Canaria, Spain',
    // Viewbox para Nominatim: limita búsquedas al área de servicio (lon_min,lat_min,lon_max,lat_max)
    SERVICE_AREA_VIEWBOX: process.env.SERVICE_AREA_VIEWBOX || '-15.55,27.99,-15.35,28.22',
    serviceTimezone: process.env.SERVICE_TIMEZONE || 'Atlantic/Canary',
    stripe: {
        secretKey: (() => {
            const key = process.env.STRIPE_SECRET_KEY;
            if (!key && process.env.NODE_ENV === 'production') {
                throw new Error('FATAL: STRIPE_SECRET_KEY es obligatorio en producción.');
            }
            return key || '';
        })(),
        webhookSecret: (() => {
            const secret = process.env.STRIPE_WEBHOOK_SECRET;
            if (!secret && process.env.NODE_ENV === 'production') {
                throw new Error('FATAL: STRIPE_WEBHOOK_SECRET es obligatorio en producción.');
            }
            return secret || '';
        })(),
        currency: process.env.STRIPE_CURRENCY || 'eur',
    },
    noShowRefundMinutes: parseInt(process.env.NO_SHOW_REFUND_MINUTES || '30', 10),
    twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID || '',
        authToken: process.env.TWILIO_AUTH_TOKEN || '',
        fromNumber: process.env.TWILIO_FROM_NUMBER || '',
    },
    vapid: {
        publicKey: process.env.VAPID_PUBLIC_KEY || 'BGscsMyO1ynEmcMgOEYb7GNr0wvkxXi8xq_VxlVOk2QwjSiURUZSJ6-Meeahfu3mxEL4-TaGnoqyAD6Bze-ZQsE',
        privateKey: process.env.VAPID_PRIVATE_KEY || '0XNrTZGcDO3c8ybvBIQsyrnSFEaSFb4MCHdfvftdAis',
        subject: process.env.VAPID_SUBJECT || 'mailto:admin@city2cruise.com',
    },
    redisUrl: process.env.REDIS_URL || '',   // empty = Redis disabled, cache bypassed
    pickupReminderHours: parseInt(process.env.PICKUP_REMINDER_HOURS || '6', 10),
    locker: {
        /** 'mock' uses MockAdapter; 'rest' uses RestAdapter (requires restBaseUrl) */
        provider: (process.env.LOCKER_PROVIDER || 'mock') as 'mock' | 'rest',
        restBaseUrl: process.env.LOCKER_REST_BASE_URL || '',
        restApiKey: process.env.LOCKER_REST_API_KEY || '',
        timeoutMs: parseInt(process.env.LOCKER_TIMEOUT_MS || '5000', 10),
        /** Fraction of calls that fail randomly in MockAdapter (0-1, for testing) */
        mockFailRate: parseFloat(process.env.LOCKER_MOCK_FAIL_RATE || '0'),
        /** Consecutive hw failures before marking locker OUT_OF_SERVICE */
        outOfServiceThreshold: parseInt(process.env.LOCKER_OOS_THRESHOLD || '3', 10),
        /** How often the sync service polls hardware state, in ms */
        syncIntervalMs: parseInt(process.env.LOCKER_SYNC_INTERVAL_MS || '60000', 10),
    },
    /** RL routing microservice (Sprint 3.E) */
    rl: {
        /** Set RL_ROUTING_ENABLED=true to activate PPO-ranked driver assignment */
        enabled: process.env.RL_ROUTING_ENABLED === 'true',
        serviceUrl: process.env.RL_SERVICE_URL || 'http://localhost:8080',
        /** Max ms to wait for the RL service before falling back to geo-distance */
        timeoutMs: parseInt(process.env.RL_SERVICE_TIMEOUT_MS || '2000', 10),
    },
    /** Shared secret for RL microservice → /api/internal/* calls (X-Internal-Key header) */
    internalApiKey: (() => {
        const key = process.env.INTERNAL_API_KEY;
        if (!key && process.env.NODE_ENV === 'production') {
            throw new Error('FATAL: INTERNAL_API_KEY es obligatorio en producción.');
        }
        return key || 'dev_internal_key_change_in_prod';
    })(),
};
