export interface ErrorResponse {
    error: {
        code: string;
        message: string;
    };
}

export interface UserDTO {
    id: number;
    name: string;
    role: 'CLIENT' | 'DRIVER' | 'ADMIN';
    latitude?: number | null;
    longitude?: number | null;
}

export interface LockerDTO {
    id: number;
    label: string;
}

export interface PickupRequestDTO {
    id: number;
    clientId: number;
    driverId: number | null;
    driver: { id: number; name: string } | null;
    pickupLocation: string;
    latitude: number | null;
    longitude: number | null;
    packageSize: 'SMALL' | 'MEDIUM' | 'LARGE';
    status: 'REQUESTED' | 'ACCEPTED' | 'CONFIRMATION_PENDING' | 'IN_PROGRESS' | 'DEPOSITED' | 'PICKED_UP';
    handshakeCode: string | null;
    handshakeExpiresAt: string | null;
    clientConfirmed: boolean;
    driverConfirmed: boolean;
    driverLatitude: number | null;
    driverLongitude: number | null;
    locker: LockerDTO | null;
    lockerCode: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface NotificationDTO {
    id: number;
    userId: number;
    type: string;
    title: string;
    message: string;
    read: boolean;
    createdAt: string;
}
