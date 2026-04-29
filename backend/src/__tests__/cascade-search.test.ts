import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { startCascadeSearch, cancelCascade, __testables } from '../services/GeoDispatchService';
import { db } from '../db/database';
import { config } from '../config/env';
import { getActiveDrivers, emitToSocket, emitToUser } from '../sockets/io';
import { logger } from '../utils/logger';
import { getPendingOfferDriverIds, registerPendingOffers } from '../services/ReassignmentService';

// Mock dependencias
jest.mock('../db/database', () => ({
    db: {
        query: jest.fn(),
    },
}));

jest.mock('../config/env', () => ({
    config: {
        searchRadii: [3, 5, 7],
        cascadeTimeout: 45000,
        SERVICE_AREA_VIEWBOX: '-15.55,27.99,-15.35,28.22',
        rl: {
            enabled: false,
            serviceUrl: 'http://localhost:8080',
            timeoutMs: 2000,
        },
    },
}));

jest.mock('../sockets/io', () => ({
    getActiveDrivers: jest.fn(),
    emitToSocket: jest.fn(),
    emitToUser: jest.fn(),
    updateActiveDriverLocation: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    },
}));

const mockQuery = db.query as any;
const flushCascade = async () => {
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(0);
};

describe('GeoDispatchService - Cascade Search', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();

        // Setup por defecto: db.query resuelve para escalada check
        mockQuery.mockResolvedValue({
            rows: [{ status: 'REQUESTED' }],
            rowCount: 1,
        });
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();

        cancelCascade(1);
    });

    describe('Fases de cascada (Con coordenadas)', () => {
        const safeDto = { latitude: 40, longitude: 20 };

        it('debería encontrar conductor en fase 1 (3km) si está dentro del radio', async () => {
            // Mock: ST_DWithin query devuelve un driver
            mockQuery
                .mockResolvedValueOnce({ rows: [{ status: 'REQUESTED' }] }) // Check status
                .mockResolvedValueOnce({ rows: [] })                        // teleport #1
                .mockResolvedValueOnce({ rows: [] })                        // teleport #2
                .mockResolvedValueOnce({ rows: [] })                        // teleport #3
                .mockResolvedValueOnce({ rows: [{ id: 101, distance_km: 2.5 }] }); // ST_DWithin

            (getActiveDrivers as jest.Mock).mockReturnValue([
                { userId: 101, socketId: 'sock-101', lat: 40.01, lon: 20.01 }
            ]);

            startCascadeSearch(1, 10, safeDto);

            // Esperar a que la fase async se resuelva
            await jest.advanceTimersByTimeAsync(100);

            expect(db.query).toHaveBeenCalled();
            expect(emitToSocket).toHaveBeenCalledWith('sock-101', 'new:pickup:request', safeDto);
            expect(emitToUser).toHaveBeenCalledWith(10, 'request:updated', { id: 1, phase: 1, radiusKm: 3 });

            // Avanzar timers no debería hacer nada más
            await jest.advanceTimersByTimeAsync(45000 * 3);
        });

        it('debería escalar a fase 2 (5km) si no hay conductores en 3km', async () => {
            // Fase 1: no hay conductores en la DB dentro de 3km
            mockQuery
                .mockResolvedValueOnce({ rows: [{ status: 'REQUESTED' }] }) // Fase 1 Status
                .mockResolvedValueOnce({ rows: [] })                       // teleport #1
                .mockResolvedValueOnce({ rows: [] })                       // teleport #2
                .mockResolvedValueOnce({ rows: [] })                       // teleport #3
                .mockResolvedValueOnce({ rows: [] })                       // Fase 1 ST_DWithin
                .mockResolvedValueOnce({ rows: [{ status: 'REQUESTED' }] }) // Fase 2 Status
                .mockResolvedValueOnce({ rows: [{ id: 102, distance_km: 4.0 }] }); // Fase 2 ST_DWithin

            (getActiveDrivers as jest.Mock).mockReturnValue([
                { userId: 102, socketId: 'sock-102', lat: 40.03, lon: 20.03 }
            ]);

            startCascadeSearch(1, 10, safeDto);

            // Esperar fase 1 (async)
            await jest.advanceTimersByTimeAsync(100);
            expect(emitToSocket).not.toHaveBeenCalled();

            // Avanzar 45s para fase 2
            await jest.advanceTimersByTimeAsync(45000);

            expect(emitToSocket).toHaveBeenCalledWith('sock-102', 'new:pickup:request', safeDto);
            expect(emitToUser).toHaveBeenCalledWith(10, 'request:updated', { id: 1, phase: 2, radiusKm: 5 });
        });

        it('debería seguir ciclando fases sin emitir request:escalated si no hay conductores en ningún radio', async () => {
            (getActiveDrivers as jest.Mock).mockReturnValue([]);
            // Todas las fases devuelven array vacío; el servicio cicla 3km→5km→7km
            mockQuery
                .mockResolvedValueOnce({ rows: [{ status: 'REQUESTED' }] }) // F1 Status
                .mockResolvedValueOnce({ rows: [] })                       // teleport #1
                .mockResolvedValueOnce({ rows: [] })                       // teleport #2
                .mockResolvedValueOnce({ rows: [] })                       // teleport #3
                .mockResolvedValueOnce({ rows: [] })                       // F1 ST_DWithin
                .mockResolvedValueOnce({ rows: [{ status: 'REQUESTED' }] }) // F2 Status
                .mockResolvedValueOnce({ rows: [] })                       // F2 ST_DWithin
                .mockResolvedValueOnce({ rows: [{ status: 'REQUESTED' }] }) // F3 Status
                .mockResolvedValueOnce({ rows: [] });                      // F3 ST_DWithin

            startCascadeSearch(1, 10, safeDto);

            // Fase 1 + 2 + 3
            await jest.advanceTimersByTimeAsync(100);
            await jest.advanceTimersByTimeAsync(135000);

            expect(emitToUser).toHaveBeenCalledWith(10, 'request:updated', { id: 1, phase: 1, radiusKm: 3 });
            expect(emitToUser).toHaveBeenCalledWith(10, 'request:updated', { id: 1, phase: 2, radiusKm: 5 });
            expect(emitToUser).toHaveBeenCalledWith(10, 'request:updated', { id: 1, phase: 3, radiusKm: 7 });
            expect(emitToUser).not.toHaveBeenCalledWith(10, 'request:escalated', expect.anything());
        });

        it('no debería escalar si el status en la BD al momento de escalar no es REQUESTED', async () => {
            (getActiveDrivers as jest.Mock).mockReturnValue([]);
            mockQuery
                .mockResolvedValueOnce({ rows: [{ status: 'REQUESTED' }] })  // Fase 1 status
                .mockResolvedValueOnce({ rows: [] })                         // teleport #1
                .mockResolvedValueOnce({ rows: [] })                         // teleport #2
                .mockResolvedValueOnce({ rows: [] })                         // teleport #3
                .mockResolvedValueOnce({ rows: [] })  // Fase 2
                .mockResolvedValueOnce({ rows: [] })  // Fase 3
                .mockResolvedValueOnce({ rows: [{ status: 'ACCEPTED' }] }); // siguiente status check

            startCascadeSearch(2, 10, safeDto);

            await jest.advanceTimersByTimeAsync(100);
            await jest.advanceTimersByTimeAsync(45000);

            expect(emitToUser).toHaveBeenCalledWith(10, 'request:updated', { id: 2, phase: 1, radiusKm: 3 });
            expect(emitToUser).not.toHaveBeenCalledWith(10, 'request:escalated', expect.anything());
            cancelCascade(2);
        });

        it('no debería escalar si el registro ya no existe en la BD', async () => {
            (getActiveDrivers as jest.Mock).mockReturnValue([]);
            mockQuery
                .mockResolvedValueOnce({ rows: [] }); // Fase 1 status - no existe

            startCascadeSearch(3, 10, safeDto);

            await jest.advanceTimersByTimeAsync(100);

            expect(emitToUser).not.toHaveBeenCalled();
            cancelCascade(3);
        });
    });

    describe('Comportamiento sin coordenadas', () => {
        const safeDtoSinCoords = { address: "Calle Falsa 123", latitude: null, longitude: null };

        it('notifica a todos los conductores activos si no hay lat/lon', async () => {
            (getActiveDrivers as jest.Mock).mockReturnValue([
                { userId: 201, socketId: 'sock-201' },
                { userId: 202, socketId: 'sock-202' }
            ]);

            const newly = await __testables.notifyDriversInRadius(4, safeDtoSinCoords, 3, new Set<number>());

            expect(emitToSocket).toHaveBeenCalledWith('sock-201', 'new:pickup:request', safeDtoSinCoords);
            expect(emitToSocket).toHaveBeenCalledWith('sock-202', 'new:pickup:request', safeDtoSinCoords);
            expect(newly).toEqual(new Set([201, 202]));
        });
    });

    describe('Cancelación y Timeout Intersectados', () => {
        const safeDto = { latitude: 40, longitude: 20 };

        it('debería limpiar ofertas pendientes al cancelar una cascada activa', async () => {
            registerPendingOffers(5, [101, 102]);
            expect(getPendingOfferDriverIds(5)).toEqual([101, 102]);

            startCascadeSearch(5, 10, safeDto);
            cancelCascade(5);

            expect(getPendingOfferDriverIds(5)).toEqual([]);
        });

        it('no rompe si se intenta cancelar una cascada inexistente', () => {
            expect(() => cancelCascade(999)).not.toThrow();
        });
    });
});
