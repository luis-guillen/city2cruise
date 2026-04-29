/**
 * Hito H-3.4 — smoke import de los contratos compartidos.
 *
 * Este archivo NO se ejecuta en runtime: existe sólo para que `tsc --noEmit`
 * verifique que el alias `@city2cruise/api-types` resuelve y que los tipos
 * exportados desde backend/src/schemas/index.ts son consumibles desde el
 * frontend.
 */
import type {
    LoginPayload,
    RegisterPayload,
    CreateRequestPayload,
    OpenLockerPayload,
    CreateCruisePayload,
    PickupRequestDTO,
    UserDTO,
    AuthTokenResponse,
} from '@city2cruise/api-types';

const _login: LoginPayload = { email: 'x@y.es', password: 'p' };
const _register: RegisterPayload = {
    name: 'A',
    email: 'a@b.es',
    password: 'PassPass123!',
    role: 'CLIENT',
    accessibility_profile: 'standard',
};
const _create: CreateRequestPayload = { pickupLocation: 'addr', packageSize: 'SMALL' };
const _open: OpenLockerPayload = { lockerCode: '123456' };
const _cruise: CreateCruisePayload = {
    vessel_name: 'Aida',
    scheduled_arrival: '2026-04-29T10:00:00Z',
    all_aboard: '2026-04-29T16:00:00Z',
    departure: '2026-04-29T17:00:00Z',
    estimated_passengers: 100,
};
const _user: UserDTO = {
    id: 1,
    name: 'A',
    email: 'a@b.es',
    role: 'CLIENT',
    created_at: '2026-04-29T00:00:00Z',
};
const _request: PickupRequestDTO = {
    id: 1,
    client_id: 1,
    driver_id: null,
    status: 'PENDING',
    pickup_location: 'addr',
    latitude: null,
    longitude: null,
    package_size: 'SMALL',
    locker_id: null,
    locker_label: null,
    locker_code: null,
    handshake_code: null,
    handshake_expires_at: null,
    client_confirmed: null,
    driver_confirmed: null,
    driver_latitude: null,
    driver_longitude: null,
    created_at: '2026-04-29T00:00:00Z',
    updated_at: '2026-04-29T00:00:00Z',
};
const _auth: AuthTokenResponse = { accessToken: 'a', user: _user };

export const _smoke = { _login, _register, _create, _open, _cruise, _user, _request, _auth };
