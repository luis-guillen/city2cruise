import { z } from 'zod';

export const createRequestSchema = z.object({
    pickupLocation: z.string().min(1, 'La dirección de recogida es obligatoria'),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
    packageSize: z.enum(['SMALL', 'MEDIUM', 'LARGE']),
    merchantId: z.number().int().positive().optional(),
});

/** Silently parsed in the accept handler — all fields optional for backward compat */
export const acceptSchema = z.object({
    driverLat: z.number().optional(),
    driverLon: z.number().optional(),
    radiusKm: z.number().optional(),
});

export const confirmDriverSchema = z.object({
    handshakeCode: z.string().regex(/^\d{4}$/, 'El código debe ser exactamente 4 dígitos numéricos'),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
});

export const depositSchema = z.object({
    lockerLabel: z.string().optional(),
});
