import { z } from 'zod';

export const openLockerSchema = z.object({
    lockerCode: z.string().regex(/^\d{6}$/, 'El código del locker debe ser exactamente 6 dígitos numéricos'),
});
