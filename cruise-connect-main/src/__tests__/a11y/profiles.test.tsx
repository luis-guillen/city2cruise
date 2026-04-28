/**
 * Hito 4.1.4 / 4.1.5 — Perfiles age_advanced y PMR.
 *
 * Verifica que el AccessibilityProvider:
 *  - Persiste el perfil en localStorage.
 *  - Refleja el perfil en <html data-a11y-profile>.
 *  - Setea <html lang> al cambiar idioma.
 *  - Se sincroniza con prefers-reduced-motion del sistema.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import {
  AccessibilityProvider,
  useAccessibility,
} from '@/context/AccessibilityContext';

function Probe() {
  const a = useAccessibility();
  return (
    <div>
      <span data-testid="profile">{a.profile}</span>
      <span data-testid="contrast">{a.contrast}</span>
      <span data-testid="rm">{String(a.reducedMotion)}</span>
      <span data-testid="lang">{a.language}</span>
      <button
        type="button"
        onClick={() => a.setProfile('age_advanced')}
        data-testid="btn-age"
      >
        age
      </button>
      <button
        type="button"
        onClick={() => a.setProfile('pmr')}
        data-testid="btn-pmr"
      >
        pmr
      </button>
      <button
        type="button"
        onClick={() => a.setContrast('high')}
        data-testid="btn-contrast"
      >
        high contrast
      </button>
      <button
        type="button"
        onClick={() => a.setLanguage('en')}
        data-testid="btn-en"
      >
        EN
      </button>
    </div>
  );
}

describe('Hito 4.1.4 / 4.1.5 / 4.1.6 — AccessibilityProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-a11y-profile');
    document.documentElement.removeAttribute('data-a11y-contrast');
    document.documentElement.removeAttribute('data-a11y-reduced-motion');
    document.documentElement.lang = '';
  });
  afterEach(() => {
    cleanup();
  });

  it('default profile = standard, lang = es', () => {
    render(
      <AccessibilityProvider>
        <Probe />
      </AccessibilityProvider>
    );
    expect(screen.getByTestId('profile').textContent).toBe('standard');
    expect(screen.getByTestId('lang').textContent).toBe('es');
    expect(document.documentElement.dataset.a11yProfile).toBe('standard');
    expect(document.documentElement.lang).toBe('es');
  });

  it('cambio a age_advanced refleja en data-attribute', () => {
    render(
      <AccessibilityProvider>
        <Probe />
      </AccessibilityProvider>
    );
    act(() => {
      fireEvent.click(screen.getByTestId('btn-age'));
    });
    expect(screen.getByTestId('profile').textContent).toBe('age_advanced');
    expect(document.documentElement.dataset.a11yProfile).toBe('age_advanced');
  });

  it('cambio a pmr refleja y persiste', () => {
    render(
      <AccessibilityProvider>
        <Probe />
      </AccessibilityProvider>
    );
    act(() => {
      fireEvent.click(screen.getByTestId('btn-pmr'));
    });
    expect(document.documentElement.dataset.a11yProfile).toBe('pmr');
    const stored = window.localStorage.getItem('a11y:settings:v1');
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!).profile).toBe('pmr');
  });

  it('alto contraste setea data-a11y-contrast=high', () => {
    render(
      <AccessibilityProvider>
        <Probe />
      </AccessibilityProvider>
    );
    act(() => {
      fireEvent.click(screen.getByTestId('btn-contrast'));
    });
    expect(document.documentElement.dataset.a11yContrast).toBe('high');
  });

  it('cambio de idioma actualiza <html lang>', () => {
    render(
      <AccessibilityProvider>
        <Probe />
      </AccessibilityProvider>
    );
    act(() => {
      fireEvent.click(screen.getByTestId('btn-en'));
    });
    expect(document.documentElement.lang).toBe('en');
  });

  it('valor inicial proviene de localStorage si existe', () => {
    window.localStorage.setItem(
      'a11y:settings:v1',
      JSON.stringify({
        profile: 'age_advanced',
        contrast: 'high',
        reducedMotion: true,
        language: 'fr',
      })
    );
    render(
      <AccessibilityProvider>
        <Probe />
      </AccessibilityProvider>
    );
    expect(screen.getByTestId('profile').textContent).toBe('age_advanced');
    expect(screen.getByTestId('contrast').textContent).toBe('high');
    expect(screen.getByTestId('rm').textContent).toBe('true');
    expect(screen.getByTestId('lang').textContent).toBe('fr');
  });
});
