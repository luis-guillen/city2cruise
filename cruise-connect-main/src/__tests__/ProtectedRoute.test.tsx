import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProtectedRoute from '@/components/ProtectedRoute';

// Module-level mock — factory cannot close over local vars (vi.mock is hoisted)
const mockAppState = { token: null as string | null, role: null as string | null };

vi.mock('@/context/AppContext', () => ({
  useApp: () => mockAppState,
}));

function renderProtectedRoute(allowedRoles: Array<'CLIENT' | 'DRIVER' | 'ADMIN'>) {
  return render(
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route path="/" element={<div>Login Page</div>} />
        <Route path="/client" element={<div>Client Page</div>} />
        <Route path="/driver" element={<div>Driver Page</div>} />
        <Route path="/admin" element={<div>Admin Page</div>} />
        <Route
          path="/protected"
          element={
            <ProtectedRoute allowedRoles={allowedRoles}>
              <div>Protected Content</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    mockAppState.token = null;
    mockAppState.role = null;
  });

  it('redirects to / when no token is present', () => {
    mockAppState.token = null;
    mockAppState.role = null;
    renderProtectedRoute(['CLIENT']);
    expect(screen.getByText('Login Page')).toBeDefined();
    expect(screen.queryByText('Protected Content')).toBeNull();
  });

  it('renders children when token is present and role matches', () => {
    mockAppState.token = 'valid-token';
    mockAppState.role = 'CLIENT';
    renderProtectedRoute(['CLIENT']);
    expect(screen.getByText('Protected Content')).toBeDefined();
  });

  it('redirects CLIENT to /client when role does not match', () => {
    mockAppState.token = 'valid-token';
    mockAppState.role = 'CLIENT';
    renderProtectedRoute(['DRIVER']);
    expect(screen.getByText('Client Page')).toBeDefined();
    expect(screen.queryByText('Protected Content')).toBeNull();
  });

  it('redirects DRIVER to /driver when role does not match', () => {
    mockAppState.token = 'valid-token';
    mockAppState.role = 'DRIVER';
    renderProtectedRoute(['CLIENT']);
    expect(screen.getByText('Driver Page')).toBeDefined();
    expect(screen.queryByText('Protected Content')).toBeNull();
  });

  it('redirects ADMIN to /admin when role does not match', () => {
    mockAppState.token = 'valid-token';
    mockAppState.role = 'ADMIN';
    renderProtectedRoute(['CLIENT']);
    expect(screen.getByText('Admin Page')).toBeDefined();
    expect(screen.queryByText('Protected Content')).toBeNull();
  });

  it('renders children when multiple roles allowed and role matches', () => {
    mockAppState.token = 'valid-token';
    mockAppState.role = 'DRIVER';
    renderProtectedRoute(['CLIENT', 'DRIVER']);
    expect(screen.getByText('Protected Content')).toBeDefined();
  });
});
