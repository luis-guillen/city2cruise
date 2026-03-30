import { PickupRequestDTO } from '../types/dto';

/**
 * Construye el objeto DTO estricto a partir de la fila devuelta por SQLite.
 */
export const buildPickupRequestDTO = (row: any): PickupRequestDTO => {
    return {
        id: row.id,
        clientId: row.client_id,
        driverId: row.driver_id ?? null,
        driver: row.driver_id && row.driver_name
            ? { id: row.driver_id, name: row.driver_name }
            : null,
        pickupLocation: row.pickup_location,
        latitude: row.latitude ?? null,
        longitude: row.longitude ?? null,
        packageSize: row.package_size || 'SMALL',
        status: row.status as 'REQUESTED' | 'ACCEPTED' | 'CONFIRMATION_PENDING' | 'IN_PROGRESS' | 'DEPOSITED' | 'PICKED_UP',
        handshakeCode: row.handshake_code ?? null,
        handshakeExpiresAt: row.handshake_expires_at ?? null,
        clientConfirmed: row.client_confirmed === true || row.client_confirmed === 1,
        driverConfirmed: row.driver_confirmed === true || row.driver_confirmed === 1,
        driverLatitude: row.driver_latitude ?? null,
        driverLongitude: row.driver_longitude ?? null,
        locker: row.locker_id ? { id: row.locker_id, label: row.locker_label } : null,
        lockerCode: row.locker_code ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
};

/**
 * Elimina reglas privativas (ej. lockerCode, handshakeCode) para envíos WebSocket
 */
export const sanitizeForSocket = (dto: PickupRequestDTO): PickupRequestDTO => {
    return {
        ...dto,
        lockerCode: null, // CRÍTICO: Nunca enviar código PIN por socket
        handshakeCode: null // CRÍTICO: Nunca enviar código handshake por socket
    };
};
