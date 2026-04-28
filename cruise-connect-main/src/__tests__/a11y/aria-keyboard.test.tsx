/**
 * Hito 4.1.2 — Regresion ARIA + teclado.
 *
 * Verifica que los componentes corregidos exponen el contrato ARIA
 * y son operables por teclado.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import Layout from '@/components/Layout';
import Navbar from '@/components/Navbar';
import GlassSegmented from '@/components/ios/GlassSegmented';
import { AppProvider } from '@/context/AppContext';
import { AccessibilityProvider } from '@/context/AccessibilityContext';

vi.mock('@/services/api', () => ({
  getNotifications: vi.fn().mockResolvedValue([]),
  markNotificationRead: vi.fn(),
  deleteAllNotifications: vi.fn(),
  loginUser: vi.fn(),
  registerUser: vi.fn(),
}));

const wrap = (children: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <AccessibilityProvider><AppProvider>
        <MemoryRouter>{children}</MemoryRouter>
      </AppProvider></AccessibilityProvider>
    </QueryClientProvider>
  );
};

describe('Hito 4.1.2 — ARIA + teclado', () => {
  it('Layout: skip-link presente y apunta a #main', () => {
    render(wrap(<Layout />));
    const skip = screen.getByText(/saltar al contenido principal/i);
    expect(skip.tagName).toBe('A');
    expect(skip.getAttribute('href')).toBe('#main');
    const main = document.getElementById('main');
    expect(main).not.toBeNull();
    expect(main?.tagName).toBe('MAIN');
    cleanup();
  });

  it('Navbar (autenticado): no renderiza nav user-actions sin role', () => {
    // Sin role activo el bloque "user actions" no debe renderse
    render(wrap(<Navbar />));
    expect(screen.queryByLabelText(/cerrar sesión/i)).toBeNull();
    cleanup();
  });

  it('GlassSegmented: implementa radiogroup + flechas mueven seleccion', () => {
    const onChange = vi.fn();
    render(
      wrap(
        <GlassSegmented
          items={[
            { id: 'a', label: 'Alfa' },
            { id: 'b', label: 'Beta' },
            { id: 'c', label: 'Gamma' },
          ]}
          active="a"
          onChange={onChange}
          ariaLabel="Test segmented"
        />
      )
    );
    const group = screen.getByRole('radiogroup', { name: /test segmented/i });
    expect(group).toBeDefined();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    expect(radios[0].tabIndex).toBe(0);
    expect(radios[1].tabIndex).toBe(-1);

    radios[0].focus();
    fireEvent.keyDown(radios[0], { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('b');

    fireEvent.keyDown(radios[0], { key: 'End' });
    expect(onChange).toHaveBeenCalledWith('c');

    fireEvent.keyDown(radios[0], { key: 'Home' });
    expect(onChange).toHaveBeenCalledWith('a');
    cleanup();
  });
});
