/**
 * Hito 4.1.5 — Test de la vista textual alternativa al mapa.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { useEffect } from 'react';
import {
  AccessibilityProvider,
  useAccessibility,
} from '@/context/AccessibilityContext';
import MapTextAlternative from '@/components/MapTextAlternative';

function PmrSetter() {
  const { setProfile } = useAccessibility();
  useEffect(() => {
    setProfile('pmr');
  }, [setProfile]);
  return null;
}

describe('Hito 4.1.5 — MapTextAlternative', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-a11y-profile');
  });
  afterEach(() => cleanup());

  it('NO se muestra en perfil estandar', () => {
    render(
      <AccessibilityProvider>
        <MapTextAlternative
          title="Seguimiento"
          locations={[{ label: 'Conductor', latitude: 28.14, longitude: -15.43 }]}
        />
      </AccessibilityProvider>
    );
    expect(screen.queryByText(/vista accesible/i)).toBeNull();
  });

  it('SI se muestra cuando profile=pmr', () => {
    render(
      <AccessibilityProvider>
        <PmrSetter />
        <MapTextAlternative
          title="Seguimiento"
          locations={[
            { label: 'Conductor', latitude: 28.14, longitude: -15.43 },
            { label: 'Locker', latitude: 28.1505, longitude: -15.4145 },
          ]}
          distanceKm={1.23}
          etaMinutes={4}
          statusText="En camino"
        />
      </AccessibilityProvider>
    );
    expect(screen.getByText(/Seguimiento — vista accesible/i)).toBeDefined();
    expect(screen.getByText(/En camino/)).toBeDefined();
    expect(screen.getByText(/1\.23 km/)).toBeDefined();
    expect(screen.getByText(/4 minutos/)).toBeDefined();
  });

  it('alwaysVisible fuerza el render aunque no sea PMR', () => {
    render(
      <AccessibilityProvider>
        <MapTextAlternative
          title="Seguimiento"
          alwaysVisible
          locations={[{ label: 'Conductor', latitude: 28.14, longitude: -15.43 }]}
        />
      </AccessibilityProvider>
    );
    expect(screen.getByText(/vista accesible/i)).toBeDefined();
  });
});
