/**
 * Hito 6.1.1 — Tests de componente NavLink (wrapper react-router NavLink).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { NavLink } from '@/components/NavLink';

function withRouter(initialPath: string, children: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="*" element={<>{children}</>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Hito 6.1.1 — NavLink', () => {
  it('renderiza un anchor con el texto y href correctos', () => {
    withRouter('/foo', <NavLink to="/admin">Admin</NavLink>);
    const a = screen.getByRole('link', { name: 'Admin' });
    expect(a).toBeInTheDocument();
    expect(a.getAttribute('href')).toBe('/admin');
  });

  it('aplica activeClassName cuando la ruta coincide con la actual', () => {
    withRouter('/admin', (
      <NavLink to="/admin" className="base" activeClassName="is-active">
        Admin
      </NavLink>
    ));
    const a = screen.getByRole('link', { name: 'Admin' });
    expect(a.className).toContain('base');
    expect(a.className).toContain('is-active');
  });

  it('NO aplica activeClassName cuando la ruta es distinta', () => {
    withRouter('/client', (
      <NavLink to="/admin" className="base" activeClassName="is-active">
        Admin
      </NavLink>
    ));
    const a = screen.getByRole('link', { name: 'Admin' });
    expect(a.className).toContain('base');
    expect(a.className).not.toContain('is-active');
  });

  it('soporta forwardRef hacia el HTMLAnchorElement subyacente', () => {
    let captured: HTMLAnchorElement | null = null;
    withRouter('/x', (
      <NavLink to="/y" ref={(el) => { captured = el; }}>
        Y
      </NavLink>
    ));
    expect(captured).not.toBeNull();
    expect(captured!.tagName).toBe('A');
  });
});
