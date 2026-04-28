/**
 * Hito 6.1.2 — Tests de useDriverGeoLocation (mock socket + geolocation).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  socket: {
    emit: vi.fn(),
    connected: true,
  },
}));
vi.mock('@/socket', () => ({ socket: mocks.socket }));
vi.mock('../socket', () => ({ socket: mocks.socket }));

import { useDriverGeoLocation } from '@/hooks/useDriverGeoLocation';

describe('Hito 6.1.2 — useDriverGeoLocation', () => {
  let originalGeo: Geolocation | undefined;

  beforeEach(() => {
    originalGeo = navigator.geolocation;
    mocks.socket.emit.mockClear();
  });

  afterEach(() => {
    if (originalGeo) {
      Object.defineProperty(window.navigator, 'geolocation', {
        value: originalGeo,
        configurable: true,
      });
    }
    vi.restoreAllMocks();
  });

  it('NO emite cuando enabled=false', async () => {
    const { result } = renderHook(() => useDriverGeoLocation(false));
    expect(mocks.socket.emit).not.toHaveBeenCalled();
    expect(result.current.location).toBeNull();
  });

  it('usa fallbackCoords cuando se proporcionan y GPS falla', async () => {
    const fakeGeo: Geolocation = {
      getCurrentPosition: () => {},
      watchPosition: (_s: PositionCallback, error?: PositionErrorCallback) => {
        error?.({
          code: 1, message: 'denied',
          PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3,
        } as GeolocationPositionError);
        return 1;
      },
      clearWatch: () => {},
    };
    Object.defineProperty(window.navigator, 'geolocation', { value: fakeGeo, configurable: true });

    const { result } = renderHook(() => useDriverGeoLocation(true, { lat: 28.10, lon: -15.50 }));
    await waitFor(() => {
      expect(result.current.location).not.toBeNull();
    });
    expect(result.current.location).toEqual({ lat: 28.10, lon: -15.50 });
  });

  it('marca outsideZone cuando GPS devuelve coords fuera de Las Palmas', async () => {
    const fakeGeo: Geolocation = {
      getCurrentPosition: () => {},
      watchPosition: (success: PositionCallback) => {
        success({
          coords: {
            latitude: 40.4168, longitude: -3.7038,
            accuracy: 10, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}),
          },
          timestamp: Date.now(),
          toJSON: () => ({}),
        } as GeolocationPosition);
        return 1;
      },
      clearWatch: () => {},
    };
    Object.defineProperty(window.navigator, 'geolocation', { value: fakeGeo, configurable: true });

    const { result } = renderHook(() => useDriverGeoLocation(true));
    await waitFor(() => expect(result.current.outsideZone).toBe(true));
  });
});
