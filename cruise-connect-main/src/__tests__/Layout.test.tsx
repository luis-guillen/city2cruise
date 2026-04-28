/**
 * Hito 6.1.1 — Tests de Layout (skip link + landmarks a11y).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Layout from '@/components/Layout';
import { AppProvider } from '@/context/AppContext';
import { AccessibilityProvider } from '@/context/AccessibilityContext';
import '@/i18n';

describe('Hito 6.1.1 — Layout', () => {
  function renderLayout() {
    return render(
      <AccessibilityProvider>
        <AppProvider>
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<p>Contenido página</p>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AppProvider>
      </AccessibilityProvider>
    );
  }

  it('expone landmark <main> con id "main" para skip-link', () => {
    renderLayout();
    const main = document.getElementById('main');
    expect(main).toBeInTheDocument();
    expect(main!.tagName).toBe('MAIN');
  });

  it('renderiza el contenido children dentro del Outlet', () => {
    renderLayout();
    expect(screen.getByText('Contenido página')).toBeInTheDocument();
  });

  it('expone landmark contentinfo (footer)', () => {
    renderLayout();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('skip-link presente y oculto hasta foco (sr-only)', () => {
    renderLayout();
    const skip = document.querySelector('a[href="#main"]');
    expect(skip).toBeInTheDocument();
    expect(skip!.className).toContain('sr-only');
  });
});
