/**
 * Hito 6.1.2 — Tests del hook useSocket (con socket.io mock).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// vi.hoisted permite tener variables accesibles desde la factory de vi.mock
const mocks = vi.hoisted(() => {
  const handlers = new Map<string, Array<(payload: unknown) => void>>();
  const socket = {
    connected: false,
    auth: {} as Record<string, unknown>,
    on: (event: string, fn: (p: unknown) => void) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(fn);
    },
    off: () => {},
    connect: () => { socket.connected = true; },
    disconnect: () => { socket.connected = false; },
    emit: () => {},
  };
  const ctx = { role: 'CLIENT' as 'CLIENT' | 'DRIVER' | 'ADMIN', refreshData: () => {}, token: 'test-token' };
  return { handlers, socket, ctx };
});

vi.mock('@/socket', () => ({ socket: mocks.socket }));
vi.mock('../socket', () => ({ socket: mocks.socket }));
vi.mock('@/context/AppContext', () => ({ useApp: () => mocks.ctx }));
vi.mock('../context/AppContext', () => ({ useApp: () => mocks.ctx }));

import { useSocket } from '@/hooks/useSocket';

describe('Hito 6.1.2 — useSocket', () => {
  let connectSpy: ReturnType<typeof vi.spyOn>;
  let refreshSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mocks.handlers.clear();
    mocks.socket.connected = false;
    mocks.socket.auth = {};
    refreshSpy = vi.fn();
    mocks.ctx.refreshData = refreshSpy;
    mocks.ctx.token = 'test-token';
    mocks.ctx.role = 'CLIENT';
    connectSpy = vi.spyOn(mocks.socket, 'connect');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('NO conecta si no hay token', () => {
    mocks.ctx.token = '';
    renderHook(() => useSocket());
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('configura auth.token y conecta cuando hay token', () => {
    renderHook(() => useSocket());
    expect(mocks.socket.auth).toEqual({ token: 'test-token' });
    expect(connectSpy).toHaveBeenCalledTimes(1);
  });

  it('registra handlers para connect, disconnect y eventos request/locker', () => {
    renderHook(() => useSocket());
    const events = Array.from(mocks.handlers.keys());
    expect(events).toContain('connect');
    expect(events).toContain('disconnect');
    expect(events).toContain('request:new');
    expect(events).toContain('request:updated');
    expect(events).toContain('locker:ready');
    expect(events).toContain('notification:new');
  });

  it('expone isConnected=true cuando se dispara handler connect', () => {
    const { result } = renderHook(() => useSocket());
    expect(result.current.isConnected).toBe(false);
    act(() => { mocks.handlers.get('connect')?.forEach(fn => fn(undefined)); });
    expect(result.current.isConnected).toBe(true);
  });

  it('llama refreshData cuando llega request:new', () => {
    renderHook(() => useSocket());
    act(() => { mocks.handlers.get('request:new')?.forEach(fn => fn({ id: 1 })); });
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it('CLIENT recibe locker:ready y emite CustomEvent locker:ready:received', () => {
    renderHook(() => useSocket());
    let received: unknown = null;
    const listener = (e: Event) => { received = (e as CustomEvent).detail; };
    window.addEventListener('locker:ready:received', listener);

    act(() => { mocks.handlers.get('locker:ready')?.forEach(fn => fn({ code: 1234 })); });
    expect(received).toEqual({ code: 1234 });

    window.removeEventListener('locker:ready:received', listener);
  });
});
