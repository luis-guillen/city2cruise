export type LockerHwStatus = 'LOCKED' | 'UNLOCKED' | 'ERROR' | 'UNKNOWN';

export interface LockerHealthReport {
    online: boolean;
    lastSeen: Date;
    errorCode?: string;
}

/**
 * Generic abstraction over any physical locker hardware.
 * lockerId is the string representation of the locker's DB id.
 */
export interface LockerHardwareAdapter {
    open(lockerId: string): Promise<void>;
    close(lockerId: string): Promise<void>;
    getStatus(lockerId: string): Promise<LockerHwStatus>;
    healthCheck(): Promise<LockerHealthReport>;
}
