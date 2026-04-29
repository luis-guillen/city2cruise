/**
 * Hito H-3.4 — Contratos API compartidos.
 *
 * Este módulo es el ÚNICO origen de verdad para los tipos de payload entre
 * el backend y el frontend. El frontend lo consume vía el alias
 * `@city2cruise/api-types` (configurado en `cruise-connect-main/vite.config.ts`
 * y `cruise-connect-main/tsconfig.app.json`).
 *
 * Si añades un endpoint o cambias un payload:
 *   1. Crea/actualiza el Zod schema en `backend/src/schemas/<feature>.schemas.ts`.
 *   2. Re-exporta el schema y el tipo `z.infer<>` desde aquí.
 *   3. Refresca el frontend (`npm run dev` lo hace automáticamente con HMR).
 *
 * El frontend NO necesita reimportar Zod si sólo consume los tipos: TypeScript
 * borra los imports de tipo en compilación.
 */
import type { z } from 'zod';

// ── Auth ──────────────────────────────────────────────────────────────────────
export {
    registerSchema,
    loginSchema,
    changePasswordSchema,
} from './auth.schemas';
import {
    registerSchema,
    loginSchema,
    changePasswordSchema,
} from './auth.schemas';

export type RegisterPayload = z.infer<typeof registerSchema>;
export type LoginPayload = z.infer<typeof loginSchema>;
export type ChangePasswordPayload = z.infer<typeof changePasswordSchema>;

// ── Pickup requests ───────────────────────────────────────────────────────────
export {
    createRequestSchema,
    acceptSchema,
    confirmDriverSchema,
    depositSchema,
} from './request.schemas';
import {
    createRequestSchema,
    acceptSchema,
    confirmDriverSchema,
    depositSchema,
} from './request.schemas';

export type CreateRequestPayload = z.infer<typeof createRequestSchema>;
export type AcceptRequestPayload = z.infer<typeof acceptSchema>;
export type ConfirmDriverPayload = z.infer<typeof confirmDriverSchema>;
export type DepositPayload = z.infer<typeof depositSchema>;

// ── Lockers ───────────────────────────────────────────────────────────────────
export { openLockerSchema } from './locker.schemas';
import { openLockerSchema } from './locker.schemas';

export type OpenLockerPayload = z.infer<typeof openLockerSchema>;

// ── Cruises ───────────────────────────────────────────────────────────────────
export {
    createCruiseSchema,
    updateCruiseStatusSchema,
} from './cruise.schemas';
import {
    createCruiseSchema,
    updateCruiseStatusSchema,
} from './cruise.schemas';

export type CreateCruisePayload = z.infer<typeof createCruiseSchema>;
export type UpdateCruiseStatusPayload = z.infer<typeof updateCruiseStatusSchema>;

// ── Resources expuestos por la API (response shapes) ──────────────────────────
// Los responses NO se validaban con Zod en el backend (sólo los inputs), así
// que aquí declaramos las shapes manualmente. Si en el futuro se añade Zod a
// las responses, sustituir por z.infer<typeof ...ResponseSchema>.

export interface UserDTO {
    id: number;
    name: string;
    email: string;
    role: 'CLIENT' | 'DRIVER' | 'ADMIN' | 'MERCHANT';
    accessibility_profile?: 'standard' | 'pmr' | 'age_advanced';
    created_at: string;
}

export interface PickupRequestDTO {
    id: number;
    client_id: number;
    driver_id: number | null;
    status:
        | 'PENDING'
        | 'CONFIRMATION_PENDING'
        | 'IN_PROGRESS'
        | 'COMPLETED'
        | 'CANCELLED';
    pickup_location: string;
    latitude: number | null;
    longitude: number | null;
    package_size: 'SMALL' | 'MEDIUM' | 'LARGE';
    locker_id: number | null;
    locker_label: string | null;
    locker_code: string | null;
    handshake_code: string | null;
    handshake_expires_at: string | null;
    client_confirmed: boolean | null;
    driver_confirmed: boolean | null;
    driver_latitude: number | null;
    driver_longitude: number | null;
    created_at: string;
    updated_at: string;
}

export interface LockerDTO {
    id: number;
    label: string;
    status: 'AVAILABLE' | 'OCCUPIED' | 'OUT_OF_SERVICE';
    latitude: number;
    longitude: number;
}

export interface AuthTokenResponse {
    accessToken: string;
    refreshToken?: string;
    user: UserDTO;
}
