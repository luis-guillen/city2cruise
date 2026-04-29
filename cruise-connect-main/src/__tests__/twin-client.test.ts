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

  it('POST /admin/intervention/cancel con Authorization si hay token', async () => {
    vi.stubEnv('VITE_TWIN_URL', 'http://twin-mock');
    vi.stubEnv('VITE_API_URL', 'http://api-mock/api');
    localStorage.setItem('token', 'jwt-admin');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);

    const { interveneCancel } = await import('@/services/twin');
    await interveneCancel(42, 'operator override');

    expect(fetchSpy).toHaveBeenCalledWith('http://api-mock/api/admin/intervention/cancel', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        Authorization: 'Bearer jwt-admin',
      }),
    }));
  });

  it('POST /admin/intervention/force-assign envía requestId y driverId', async () => {
    vi.stubEnv('VITE_TWIN_URL', 'http://twin-mock');
    vi.stubEnv('VITE_API_URL', 'http://api-mock/api');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);

    const { interveneForceAssign } = await import('@/services/twin');
    await interveneForceAssign(12, 8);

    const [, init] = fetchSpy.mock.calls[0];
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ requestId: 12, driverId: 8 });
  });
});
