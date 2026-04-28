import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from '@/pages/LoginPage';

// Mock dependencies
vi.mock('@/services/api', () => ({
  loginUser: vi.fn(),
  registerUser: vi.fn(),
}));

vi.mock('@/context/AppContext', () => ({
  useApp: () => ({
    setUser: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// react-router-dom navigate mock
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderLoginPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_DEMO_MODE', 'true');
  });

  it('renders login tab by default', () => {
    renderLoginPage();
    expect(screen.getByRole('radio', { name: /iniciar sesión/i })).toBeDefined();
    expect(screen.getByRole('radio', { name: /registrarse/i })).toBeDefined();
  });

  it('login tab shows email and password fields', () => {
    renderLoginPage();
    expect(screen.getByPlaceholderText(/tu@email\.com/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/mínimo 6 caracteres/i)).toBeDefined();
    // Name field should NOT be visible in login mode
    expect(screen.queryByPlaceholderText(/tu nombre/i)).toBeNull();
  });

  it('register tab shows name, email and password fields', async () => {
    renderLoginPage();
    fireEvent.click(screen.getByRole('radio', { name: /registrarse/i }));
    expect(screen.getByPlaceholderText(/tu nombre/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/tu@email\.com/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/mínimo 6 caracteres/i)).toBeDefined();
  });

  it('does not submit if email or password are empty', async () => {
    const { loginUser } = await import('@/services/api');
    renderLoginPage();
    // In current implementation, handleSubmit does validation
    fireEvent.submit(screen.getByRole('button', { name: /iniciar sesión/i }).closest('form')!);
    await waitFor(() => {
      expect(loginUser).not.toHaveBeenCalled();
    });
  });

  it('calls loginUser with email and password on login submit', async () => {
    const { loginUser } = await import('@/services/api');
    vi.mocked(loginUser).mockResolvedValue({
      token: 'test-token',
      user: { id: 1, name: 'Test', role: 'CLIENT', latitude: null, longitude: null },
    });

    renderLoginPage();
    fireEvent.change(screen.getByPlaceholderText(/tu@email\.com/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText(/mínimo 6 caracteres/i), {
      target: { value: 'password123' },
    });
    fireEvent.submit(screen.getByRole('button', { name: /iniciar sesión/i }).closest('form')!);

    await waitFor(() => {
      expect(loginUser).toHaveBeenCalledWith('test@example.com', 'password123');
    });
  });

  it('shows submit button as "Crear cuenta" in register mode', () => {
    renderLoginPage();
    fireEvent.click(screen.getByRole('radio', { name: /registrarse/i }));
    expect(screen.getByRole('button', { name: /crear cuenta/i })).toBeDefined();
  });
});
