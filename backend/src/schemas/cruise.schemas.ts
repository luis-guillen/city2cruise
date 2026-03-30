import { z } from 'zod';

export const createCruiseSchema = z.object({
    vessel_name: z.string().min(1, 'Nombre del buque obligatorio'),
    imo_number: z.string().optional(),
    scheduled_arrival: z.string().datetime({ message: 'Formato ISO 8601 requerido' }),
    all_aboard: z.string().datetime({ message: 'Formato ISO 8601 requerido' }),
    departure: z.string().datetime({ message: 'Formato ISO 8601 requerido' }),
    terminal: z.string().optional(),
    estimated_passengers: z.number().int().min(0).default(0),
});

export const updateCruiseStatusSchema = z.object({
    status: z.enum(['scheduled', 'docked', 'departed', 'cancelled']),
});
