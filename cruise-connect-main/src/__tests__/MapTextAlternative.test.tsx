/**
 * Hito 6.1.1 — Tests de MapTextAlternative (vista accesible alternativa al mapa).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import MapTextAlternative from '@/components/MapTextAlternative';
import { AccessibilityProvider } from '@/context/AccessibilityContext';

const STORAGE_KEY = 'a11y:settings:v1';

const sample = [
  { label: 'Tu posición', latitude: 28.123, longitude: -15.436 },
  { label: 'Conductor', latitude: 28.130, longitude: -15.430, meta: 'ETA 5 min' },
];

function renderWithProfile(profile: 'standard' | 'age_advanced' | 'pmr', extra: Record<string, unknown> = {}) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
    profile, contrast: 'auto', reducedMotion: false, language: 'es',
  }));
  return render(
    <AccessibilityProvider>
      <MapTextAlternative title="Trayecto" locations={sample} {...extra} />
    </AccessibilityProvider>
  );
}

describe('Hito 6.1.1 — MapTextAlternative', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('NO se renderiza con perfil standard y alwaysVisible=false', () => {
    renderWithProfile('standard');
    expect(screen.queryByText(/Trayecto/)).not.toBeInTheDocument();
  });

  it('se renderiza con perfil pmr aunque alwaysVisible sea false', () => {
    renderWithProfile('pmr');
    expect(screen.getByText(/Trayecto/)).toBeInTheDocument();
    expect(screen.getByText(/Tu posición/)).toBeInTheDocument();
    expect(screen.getByText(/Conductor/)).toBeInTheDocument();
  });

  it('alwaysVisible=true fuerza render incluso con perfil standard', () => {
    renderWithProfile('standard', { alwaysVisible: true });
    expect(screen.getByText(/Trayecto/)).toBeInTheDocument();
  });

  it('muestra distancia y ETA cuando se pasan', () => {
    renderWithProfile('pmr', { distanceKm: 1.4, etaMinutes: 7 });
    const text = document.body.textContent || '';
    expect(text).toMatch(/1[.,]4/);
    expect(text).toMatch(/7/);
  });

  it('renderiza statusText cuando se proporciona', () => {
    renderWithProfile('pmr', { statusText: 'En camino al locker' });
    expect(screen.getByText(/En camino al locker/)).toBeInTheDocument();
  });
});
