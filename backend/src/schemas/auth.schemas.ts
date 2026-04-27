import { z } from 'zod';
import { validatePassword } from '../auth/passwordPolicy';

const strongPassword = z.string().superRefine((val, ctx) => {
    const { valid, errors } = validatePassword(val);
    if (!valid) {
        errors.forEach((msg) =>
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg })
        );
    }
});

export const registerSchema = z.object({
    name: z.string().min(1, 'El nombre es obligatorio'),
    email: z.string().email('Correo electrónico inválido'),
    password: strongPassword,
    role: z.enum(['CLIENT', 'DRIVER']),
    vehicle_identifier: z.string().optional(),
    accessibility_profile: z.enum(['standard', 'pmr', 'age_advanced']).default('standard'),
    device_identifier: z.string().optional(),
});

export const loginSchema = z.object({
    email: z.string().email('Correo electrónico inválido'),
    password: z.string().min(1, 'La contraseña es obligatoria'),
});

export const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'La contraseña actual es obligatoria'),
    newPassword: strongPassword,
});
