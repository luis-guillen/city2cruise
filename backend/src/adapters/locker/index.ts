import { MockAdapter } from './MockAdapter';
import { RestAdapter } from './RestAdapter';
import type { LockerHardwareAdapter } from './LockerHardwareAdapter';
import { createLockerBreaker } from './circuitBreaker';
import { config } from '../../config/env';
import CircuitBreaker from 'opossum';

// Re-export types for consumers
export type { LockerHardwareAdapter, LockerHwStatus, LockerHealthReport } from './LockerHardwareAdapter';
export { createLockerBreaker } from './circuitBreaker';

// ── Singleton adapter ──────────────────────────────────────────────────────────

let _adapter: LockerHardwareAdapter | null = null;

export function getLockerAdapter(): LockerHardwareAdapter {
    if (!_adapter) {
        if (config.locker.provider === 'rest' && config.locker.restBaseUrl) {
            _adapter = new RestAdapter({
                baseUrl: config.locker.restBaseUrl,
                apiKey: config.locker.restApiKey,
                timeoutMs: config.locker.timeoutMs,
            });
        } else {
            _adapter = new MockAdapter(config.locker.mockFailRate);
        }
    }
    return _adapter;
}

// ── Circuit-breaker-wrapped adapter ───────────────────────────────────────────
// One breaker per operation so a noisy getStatus doesn't block open().

type OpenFn = (id: string) => Promise<void>;
type CloseFn = (id: string) => Promise<void>;
type GetStatusFn = (id: string) => ReturnType<LockerHardwareAdapter['getStatus']>;
type HealthFn = () => ReturnType<LockerHardwareAdapter['healthCheck']>;

let _openBreaker: CircuitBreaker<[string], void> | null = null;
let _closeBreaker: CircuitBreaker<[string], void> | null = null;
let _statusBreaker: CircuitBreaker<[string], Awaited<ReturnType<LockerHardwareAdapter['getStatus']>>> | null = null;
let _healthBreaker: CircuitBreaker<[], Awaited<ReturnType<LockerHardwareAdapter['healthCheck']>>> | null = null;

function adapter() { return getLockerAdapter(); }

export function getLockerBreakers() {
    if (!_openBreaker) {
        _openBreaker = createLockerBreaker<[string], void>(
            (id) => adapter().open(id),
            { name: 'locker:open' },
        );
        _closeBreaker = createLockerBreaker<[string], void>(
            (id) => adapter().close(id),
            { name: 'locker:close' },
        );
        _statusBreaker = createLockerBreaker<[string], Awaited<ReturnType<GetStatusFn>>>(
            (id) => adapter().getStatus(id),
            { name: 'locker:status', timeoutMs: 3000 },
        );
        _healthBreaker = createLockerBreaker<[], Awaited<ReturnType<HealthFn>>>(
            () => adapter().healthCheck(),
            { name: 'locker:health', timeoutMs: 3000 },
        );
    }
    return {
        open: _openBreaker!,
        close: _closeBreaker!,
        status: _statusBreaker!,
        health: _healthBreaker!,
    };
}
