/**
 * Hito 6.1.2 — Tests del hook useClientGeoLocation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useClientGeoLocation } from '@/hooks/useClientGeoLocation';

describe('Hito 6.1.2 — useClientGeoLocation', () => {
  let originalGeolocation: Geolocation | undefined;

  beforeEach(() => {
    originalGeolocation = navigator.geolocation;
    // @ts-expect-error mocking
    delete (window.navigator as { geolocation?: Geolocation }).geolocation;
  });

  afterEach(() => {
    if (originalGeolocation) {
      Object.defineProperty(window.navigator, 'geolocation', {
        value: originalGeolocation,
        configurable: true,
      });
    }
    vi.restoreAllMocks();
  });

  it('cuando GPS no existe usa fallback Las Palmas (loading=false)', async () => {
    const { result } = renderHook(() => useClientGeoLocation());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.location).not.toBeNull();
    expect(result.current.usingFallback).toBe(true);
    // Las Palmas bbox approximado
    expect(result.current.location!.lat).toBeGreaterThan(27.9);
    expect(result.current.location!.lat).toBeLessThan(28.3);
  });

  it('cuando GPS éxito y posición dentro de Las Palmas devuelve coords reales sin outsideZone', async () => {
    const fakeGeo: Geolocation = {
      getCurrentPosition: (success: PositionCallback) => {
        success({
          coords: {
            latitude: 28.123, longitude: -15.436,
            accuracy: 10, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}),
          },
          timestamp: Date.now(),
          toJSON: () => ({}),
        } as GeolocationPosition);
      },
      watchPosition: () => 0,
      clearWatch: () => {},
    };
    Object.defineProperty(window.navigator, 'geolocation', { value: fakeGeo, configurable: true });

    const { result } = renderHook(() => useClientGeoLocation());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.location).toEqual({ lat: 28.123, lon: -15.436 });
    expect(result.current.outsideZone).toBe(false);
    expect(result.current.usingFallback).toBe(false);
  });

  it('cuando GPS éxito pero fuera de zona marca outsideZone=true', async () => {
    const fakeGeo: Geolocation = {
      getCurrentPosition: (success: PositionCallback) => {
        success({
          coords: {
            latitude: 40.4168, longitude: -3.7038, // Madrid
            accuracy: 10, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}),
          },
          timestamp: Date.now(),
          toJSON: () => ({}),
        } as GeolocationPosition);
      },
      watchPosition: () => 0,
      clearWatch: () => {},
    };
    Object.defineProperty(window.navigator, 'geolocation', { value: fakeGeo, configurable: true });

    const { result } = renderHook(() => useClientGeoLocation());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.outsideZone).toBe(true);
  });

  it('cuando GPS falla usa fallback Las Palmas', async () => {
    const fakeGeo: Geolocation = {
      getCurrentPosition: (_s: PositionCallback, error?: PositionErrorCallback) => {
        error?.({
          code: 1, message: 'denied',
          PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3,
        } as GeolocationPositionError);
      },
      watchPosition: () => 0,
      clearWatch: () => {},
    };
    Object.defineProperty(window.navigator, 'geolocation', { value: fakeGeo, configurable: true });

    const { result } = renderHook(() => useClientGeoLocation());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.usingFallback).toBe(true);
    expect(result.current.location!.lat).toBeGreaterThan(27.9);
  });
});
