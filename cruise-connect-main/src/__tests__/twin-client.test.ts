/**
 * Hito 5.4.4 — tests del cliente del Twin (frontend).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Hito 5.4.4 — services/twin (cliente frontend)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('lanza error si VITE_TWIN_URL no está definido', async () => {
    vi.stubEnv('VITE_TWIN_URL', '');
    const { fetchTwinSnapshot } = await import('@/services/twin');
    await expect(fetchTwinSnapshot()).rejects.toThrow(/VITE_TWIN_URL/);
  });

  it('llama a $TWIN_URL/state cuando VITE_TWIN_URL está set', async () => {
    vi.stubEnv('VITE_TWIN_URL', 'http://twin-mock');
    const fakeBody = {
      timestamp: '2026-04-28T14:00:00Z',
      env: 'simulation',
      lockers: [],
      drivers: [],
      requests: [],
      aggregates: {
        lockers_total: 0, lockers_free: 0, lockers_occupied: 0, lockers_out: 0,
        drivers_total: 0, drivers_online: 0, drivers_available: 0,
        requests_active: 0, avg_match_seconds_15m: 0,
      },
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => fakeBody,
    } as unknown as Response);

    const { fetchTwinSnapshot } = await import('@/services/twin');
    const out = await fetchTwinSnapshot();

    expect(fetchSpy).toHaveBeenCalledWith('http://twin-mock/state', expect.objectContaining({
      headers: { Accept: 'application/json' },
    }));
    expect(out.env).toBe('simulation');
  });

  it('lanza con status code si la respuesta no es ok', async () => {
    vi.stubEnv('VITE_TWIN_URL', 'http://twin-mock');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 502 } as Response);

    const { fetchTwinSnapshot } = await import('@/services/twin');
    await expect(fetchTwinSnapshot()).rejects.toThrow(/502/);
  });
});
