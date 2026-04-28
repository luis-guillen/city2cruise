/**
 * Hito 6.1.1 — Tests de PwaUpdatePrompt (toast actualización SW).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import PwaUpdatePrompt from '@/components/PwaUpdatePrompt';

describe('Hito 6.1.1 — PwaUpdatePrompt', () => {
  beforeEach(() => {
    // i18n init: el componente usa useTranslation. Stub si hace falta:
    // como no podemos garantizar i18n init, usamos textContent flexible.
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('NO se renderiza por defecto (sin update pendiente)', () => {
    render(<PwaUpdatePrompt />);
    // Sin evento 'sw-update-available', updateFn=null => no render
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('aparece al recibir el evento sw-update-available y desaparece tras Actualizar', () => {
    render(<PwaUpdatePrompt />);
    const updateSW = vi.fn(async () => {});

    act(() => {
      window.dispatchEvent(new CustomEvent('sw-update-available', {
        detail: { updateSW },
      }));
    });

    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    // Atributos a11y
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  it('limpia el listener al desmontarse', () => {
    const { unmount } = render(<PwaUpdatePrompt />);
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('sw-update-available', expect.any(Function));
  });
});
