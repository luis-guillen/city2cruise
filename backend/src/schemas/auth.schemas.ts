import { z } from 'zod';

export const registerSchema = z.object({
    name: z.string().min(1, 'El nombre es obligatorio'),
    email: z.string().email('Correo electrónico inválido'),
    password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
    role: z.enum(['CLIENT', 'DRIVER']),
    vehicle_identifier: z.string().optional(),
    accessibility_profile: z.enum(['standard', 'pmr', 'age_advanced']).default('standard'),
    device_identifier: z.string().optional(),
});

export const loginSchema = z.object({
    email: z.string().email('Correo electrónico inválido'),
    password: z.string().min(1, 'La contraseña es obligatoria'),
});
