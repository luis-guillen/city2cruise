/**
 * Hito 6.1.2 — Tests de useDriverGeoLocation (mock socket + geolocation).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  socket: {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    connected: true,
  },
}));
vi.mock('@/socket', () => ({ socket: mocks.socket }));
vi.mock('../socket', () => ({ socket: mocks.socket }));
vi.mock('@/utils/throttle', () => ({
  throttle: <TArgs extends unknown[]>(fn: (...args: TArgs) => void) => {
    const wrapped = ((...args: TArgs) => fn(...args)) as ((...args: TArgs) => void) & { cancel: () => void };
    wrapped.cancel = () => {};
    return wrapped;
  },
}));

import { useDriverGeoLocation } from '@/hooks/useDriverGeoLocation';

describe('Hito 6.1.2 — useDriverGeoLocation', () => {
  let originalGeo: Geolocation | undefined;
  const listeners = new Map<string, (...args: any[]) => void>();

  beforeEach(() => {
    vi.stubEnv('VITE_DEMO_MODE', 'false');
    originalGeo = navigator.geolocation;
    mocks.socket.emit.mockClear();
    mocks.socket.on.mockImplementation((event: string, handler: (...args: any[]) => void) => {
      listeners.set(event, handler);
    });
    mocks.socket.off.mockImplementation((event: string) => {
      listeners.delete(event);
    });
  });

  afterEach(() => {
    if (originalGeo) {
      Object.defineProperty(window.navigator, 'geolocation', {
        value: originalGeo,
        configurable: true,
      });
    }
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    listeners.clear();
  });

  it('NO emite cuando enabled=false', async () => {
    const { result, unmount } = renderHook(() => useDriverGeoLocation(false));
    expect(mocks.socket.emit).not.toHaveBeenCalled();
    expect(result.current.location).toBeNull();
    unmount();
  });

  it('usa fallbackCoords cuando se proporcionan y GPS falla', async () => {
    const stableFallback = { lat: 28.10, lon: -15.50 };
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

    const { result, unmount } = renderHook(() => useDriverGeoLocation(true, stableFallback));
    await waitFor(() => {
      expect(result.current.location).not.toBeNull();
    });
    expect(result.current.location).toEqual({ lat: 28.10, lon: -15.50 });
    unmount();
  });

  it('emite la posicion inicial en demo para mantener activo al driver', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    mocks.socket.connected = false;
    const fakeGeo: Geolocation = {
      getCurrentPosition: () => {},
      watchPosition: () => 1,
      clearWatch: () => {},
    };
    Object.defineProperty(window.navigator, 'geolocation', { value: fakeGeo, configurable: true });

    const fallback = { lat: 28.1234, lon: -15.4321 };
    const { unmount } = renderHook(() => useDriverGeoLocation(true, fallback, true));

    await waitFor(() => {
      expect(listeners.has('connect')).toBe(true);
    });

    mocks.socket.connected = true;
    listeners.get('connect')?.();
    expect(mocks.socket.emit).toHaveBeenCalledWith('driver:location:update', fallback);
    unmount();
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

    const { result, unmount } = renderHook(() => useDriverGeoLocation(true));
    await waitFor(() => expect(result.current.outsideZone).toBe(true));
    unmount();
  });
});
