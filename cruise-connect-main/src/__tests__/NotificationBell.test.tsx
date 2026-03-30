import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NotificationBell from '@/components/NotificationBell';
import type { NotificationDTO } from '@/services/api';

// AppContext mock — controlled per test
const mockAppState = { role: 'CLIENT' as string | null };
vi.mock('@/context/AppContext', () => ({
  useApp: () => mockAppState,
}));

// Socket hook — no-op
vi.mock('@/hooks/useSocket', () => ({ useSocket: () => {} }));

// Sonner
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// API mock
const mockGetNotifications = vi.fn<() => Promise<NotificationDTO[]>>();
const mockMarkNotificationRead = vi.fn();
const mockDeleteAllNotifications = vi.fn();

vi.mock('@/services/api', () => ({
  getNotifications: () => mockGetNotifications(),
  markNotificationRead: (id: number) => mockMarkNotificationRead(id),
  deleteAllNotifications: () => mockDeleteAllNotifications(),
}));

const makeNotif = (overrides: Partial<NotificationDTO> = {}): NotificationDTO => ({
  id: 1,
  userId: 10,
  type: 'INFO',
  title: 'Test title',
  message: 'Test message',
  read: false,
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppState.role = 'CLIENT';
    mockGetNotifications.mockResolvedValue([]);
  });

  it('renders nothing when role is not CLIENT', () => {
    mockAppState.role = 'DRIVER';
    const { container } = render(<NotificationBell />);
    expect(container.firstChild).toBeNull();
  });

  it('renders bell button when role is CLIENT', async () => {
    render(<NotificationBell />);
    await waitFor(() => expect(mockGetNotifications).toHaveBeenCalledOnce());
    expect(screen.getByRole('button')).toBeDefined();
  });

  it('shows no unread badge when all notifications are read', async () => {
    mockGetNotifications.mockResolvedValue([makeNotif({ read: true })]);
    render(<NotificationBell />);
    await waitFor(() => expect(mockGetNotifications).toHaveBeenCalledOnce());
    // Badge only shows for unread > 0
    expect(screen.queryByText('1')).toBeNull();
  });

  it('shows unread count badge when there are unread notifications', async () => {
    mockGetNotifications.mockResolvedValue([makeNotif({ read: false }), makeNotif({ id: 2, read: false })]);
    render(<NotificationBell />);
    await waitFor(() => expect(screen.getByText('2')).toBeDefined());
  });

  it('opens notification panel on bell click', async () => {
    mockGetNotifications.mockResolvedValue([]);
    render(<NotificationBell />);
    await waitFor(() => expect(mockGetNotifications).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Notificaciones')).toBeDefined();
  });

  it('shows empty state message when no notifications', async () => {
    mockGetNotifications.mockResolvedValue([]);
    render(<NotificationBell />);
    await waitFor(() => expect(mockGetNotifications).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('No tienes notificaciones')).toBeDefined();
  });

  it('shows notification titles in the panel', async () => {
    mockGetNotifications.mockResolvedValue([makeNotif({ title: 'Conductor en camino' })]);
    render(<NotificationBell />);
    await waitFor(() => expect(mockGetNotifications).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Conductor en camino')).toBeDefined();
  });
});
