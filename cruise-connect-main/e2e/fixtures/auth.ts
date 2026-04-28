/**
 * Hito 6.2.1 — Fixture compartida: API helpers para preparar usuarios test
 *
 * Estos helpers asumen que el backend está corriendo y accesible en
 * BACKEND_URL (default http://127.0.0.1:9000). Para CI usar URL del staging.
 */
import { request, type APIRequestContext } from '@playwright/test';

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:9000';
const API = `${BACKEND_URL}/api`;

export interface TestUser {
  email: string;
  password: string;
  name: string;
  role: 'CLIENT' | 'DRIVER' | 'ADMIN';
  token?: string;
  id?: number;
}

export function makeUser(role: TestUser['role'], suffix?: string): TestUser {
  const tag = suffix || Math.random().toString(36).slice(2, 8);
  return {
    email: `e2e-${role.toLowerCase()}-${tag}@example.com`,
    password: 'TestPassword123!',
    name: `E2E ${role} ${tag}`,
    role,
  };
}

export async function registerAndLogin(api: APIRequestContext, user: TestUser): Promise<TestUser> {
  // Intenta registrar; si ya existe, sigue con login
  const reg = await api.post(`${API}/auth/register`, {
    data: {
      name: user.name,
      email: user.email,
      password: user.password,
      role: user.role,
    },
    failOnStatusCode: false,
  });
  if (reg.ok()) {
    const body = await reg.json();
    user.token = body.token;
    user.id = body.user?.id;
    return user;
  }

  // Login si ya existía
  const login = await api.post(`${API}/auth/login`, {
    data: { email: user.email, password: user.password },
  });
  const body = await login.json();
  user.token = body.token;
  user.id = body.user?.id;
  return user;
}

export async function newApiContext(): Promise<APIRequestContext> {
  return await request.newContext({ baseURL: API });
}
