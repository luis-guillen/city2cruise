/**
 * Hito 5.4.3 — TwinSyncService: fire-and-forget + circuit breaker.
 */
describe('Hito 5.4.3 — TwinSyncService', () => {
    const ORIGINAL_ENV = { ...process.env };

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.resetModules();
        jest.restoreAllMocks();
    });

    it('es no-op cuando TWIN_URL no está definido', async () => {
        delete process.env.TWIN_URL;
        const fetchSpy = jest.fn();
        global.fetch = fetchSpy as unknown as typeof fetch;

        const { syncRequestCreated } = await import('../services/twin/TwinSyncService');
        await syncRequestCreated(1, 100, 5);

        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('hace POST /sync con el body esperado cuando TWIN_URL está set', async () => {
        process.env.TWIN_URL = 'http://twin-mock';
        const fetchSpy: jest.Mock = jest.fn(async () => ({ ok: true, status: 202 } as Response));
        global.fetch = fetchSpy as unknown as typeof fetch;

        const mod = await import('../services/twin/TwinSyncService');
        mod._resetCircuitForTests();
        await mod.syncRequestCreated(42, 7, 3);

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toBe('http://twin-mock/sync');
        expect((init as RequestInit).method).toBe('POST');
        const body = JSON.parse((init as RequestInit).body as string);
        expect(body.event_type).toBe('request.created');
        expect(body.payload).toEqual({ request_id: 42, client_id: 7, locker_id: 3 });
        expect(typeof body.timestamp).toBe('string');
    });

    it('abre circuit breaker tras 5 fallos consecutivos y deja de llamar', async () => {
        process.env.TWIN_URL = 'http://twin-mock';
        const fetchSpy = jest.fn(async () => { throw new Error('boom'); });
        global.fetch = fetchSpy as unknown as typeof fetch;

        const mod = await import('../services/twin/TwinSyncService');
        mod._resetCircuitForTests();

        for (let i = 0; i < 5; i++) {
            await mod.syncRequestCreated(i, 1);
        }
        expect(fetchSpy).toHaveBeenCalledTimes(5);

        // Sexta llamada debe ser no-op (circuit open)
        await mod.syncRequestCreated(99, 1);
        expect(fetchSpy).toHaveBeenCalledTimes(5);
    });

    it('incluye X-Internal-Key si TWIN_INTERNAL_KEY está set', async () => {
        process.env.TWIN_URL = 'http://twin-mock';
        process.env.TWIN_INTERNAL_KEY = 'secret-123';
        const fetchSpy: jest.Mock = jest.fn(async () => ({ ok: true, status: 202 } as Response));
        global.fetch = fetchSpy as unknown as typeof fetch;

        const mod = await import('../services/twin/TwinSyncService');
        mod._resetCircuitForTests();
        await mod.syncRequestCreated(1, 1);

        const init = fetchSpy.mock.calls[0][1] as RequestInit;
        expect((init.headers as Record<string, string>)['X-Internal-Key']).toBe('secret-123');
    });
});
