import axios, { type AxiosInstance } from 'axios';
import type { LockerHardwareAdapter, LockerHwStatus, LockerHealthReport } from './LockerHardwareAdapter';

export interface RestAdapterConfig {
    /** Base URL of the locker provider REST API, e.g. https://api.lockerprovider.com/v1 */
    baseUrl: string;
    apiKey: string;
    timeoutMs?: number;
    /** Optional CA bundle path for mTLS — set at Axios httpsAgent level */
    caCertPath?: string;
}

/**
 * REST skeleton adapter for real locker hardware providers.
 * URL shapes and response contracts must be adapted per vendor.
 * Currently a typed skeleton; all methods throw unless the provider URL is configured.
 */
export class RestAdapter implements LockerHardwareAdapter {
    private readonly http: AxiosInstance;

    constructor(private readonly cfg: RestAdapterConfig) {
        this.http = axios.create({
            baseURL: cfg.baseUrl,
            timeout: cfg.timeoutMs ?? 5000,
            headers: {
                'Authorization': `Bearer ${cfg.apiKey}`,
                'Content-Type': 'application/json',
            },
        });
    }

    async open(lockerId: string): Promise<void> {
        // POST /lockers/{id}/open → 200 OK
        await this.http.post(`/lockers/${lockerId}/open`);
    }

    async close(lockerId: string): Promise<void> {
        // POST /lockers/{id}/close → 200 OK
        await this.http.post(`/lockers/${lockerId}/close`);
    }

    async getStatus(lockerId: string): Promise<LockerHwStatus> {
        // GET /lockers/{id}/status → { status: 'LOCKED' | 'UNLOCKED' | 'ERROR' | 'UNKNOWN' }
        const { data } = await this.http.get<{ status: LockerHwStatus }>(`/lockers/${lockerId}/status`);
        return data.status;
    }

    async healthCheck(): Promise<LockerHealthReport> {
        // GET /health → { status: 'ok' | 'error', errorCode?: string }
        const { data } = await this.http.get<{ status: string; errorCode?: string }>('/health');
        return {
            online: data.status === 'ok',
            lastSeen: new Date(),
            errorCode: data.errorCode,
        };
    }
}
