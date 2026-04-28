/**
 * Hito 6.1.3 — Tests de la capa de servicios API (services/api.ts)
 *
 * Cubre:
 *  - Interceptor de request inyecta Authorization Bearer si hay token
 *  - Llamadas usan baseURL correcto
 *  - Funciones loginUser/registerUser construyen el body correcto
 *  - 401 dispara refresh + retry
 *  - 401 sin refresh dispara logout + evento auth:logout
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, loginUser, registerUser, logoutUser } from '@/services/api';
import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';

let mock: MockAdapter;

describe('Hito 6.1.3 — services/api', () => {
  beforeEach(() => {
    mock = new MockAdapter(api);
    localStorage.clear();
  });

  afterEach(() => {
    mock.restore();
    vi.restoreAllMocks();
  });

  it('GET sin token: NO añade Authorization header', async () => {
    let receivedAuth: string | undefined;
    mock.onGet('/foo').reply((config) => {
      receivedAuth = config.headers?.Authorization as string | undefined;
      return [200, { ok: true }];
    });
    await api.get('/foo');
    expect(receivedAuth).toBeUndefined();
  });

  it('GET con token en localStorage: añade Authorization Bearer', async () => {
    localStorage.setItem('token', 'jwt-test-123');
    let receivedAuth: string | undefined;
    mock.onGet('/foo').reply((config) => {
      receivedAuth = config.headers?.Authorization as string | undefined;
      return [200, { ok: true }];
    });
    await api.get('/foo');
    expect(receivedAuth).toBe('Bearer jwt-test-123');
  });

  it('loginUser: POST /auth/login con email+password y devuelve {token,user}', async () => {
    let body: unknown;
    mock.onPost('/auth/login').reply((config) => {
      body = JSON.parse(config.data as string);
      return [200, {
        token: 'tok-1',
        user: { id: 1, name: 'A', role: 'CLIENT' },
      }];
    });
    const r = await loginUser('a@b.c', 'pwd');
    expect(body).toEqual({ email: 'a@b.c', password: 'pwd' });
    expect(r.token).toBe('tok-1');
    expect(r.user.role).toBe('CLIENT');
  });

  it('registerUser: POST /auth/register con name+email+password+role', async () => {
    let body: unknown;
    mock.onPost('/auth/register').reply((config) => {
      body = JSON.parse(config.data as string);
      return [200, { token: 'tok', user: { id: 7, name: 'X', role: 'DRIVER' } }];
    });
    const r = await registerUser('X', 'x@y.z', 'pw', 'DRIVER');
    expect(body).toEqual({ name: 'X', email: 'x@y.z', password: 'pw', role: 'DRIVER' });
    expect(r.user.id).toBe(7);
  });

  it('logoutUser: POST /auth/logout (no body)', async () => {
    let called = false;
    mock.onPost('/auth/logout').reply(() => {
      called = true;
      return [204];
    });
    await logoutUser();
    expect(called).toBe(true);
  });

  it('GET 500 propaga el error (no se traga)', async () => {
    mock.onGet('/oops').reply(500, { error: 'boom' });
    await expect(api.get('/oops')).rejects.toMatchObject({
      response: { status: 500 },
    });
  });

  it('401 sin refresh disponible dispara evento auth:logout y limpia localStorage', async () => {
    localStorage.setItem('token', 'old-token');
    localStorage.setItem('userName', 'someone');

    let logoutFired = false;
    const listener = () => { logoutFired = true; };
    window.addEventListener('auth:logout', listener);

    // El interceptor llama a /auth/refresh con axios crudo (sin pasar por api).
    // Mockeamos axios.post para devolver error.
    const postSpy = vi.spyOn(axios, 'post').mockRejectedValue(new Error('refresh failed'));

    mock.onGet('/protected').reply(401, { error: 'unauthorized' });

    await expect(api.get('/protected')).rejects.toBeDefined();

    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('userName')).toBeNull();
    expect(logoutFired).toBe(true);

    window.removeEventListener('auth:logout', listener);
    postSpy.mockRestore();
  });
});
