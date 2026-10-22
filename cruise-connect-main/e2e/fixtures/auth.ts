/**
 * Hito 6.2.1 — Fixture compartida: API helpers para preparar usuarios test
 *
 * Estos helpers asumen que el backend está corriendo y accesible en
 * BACKEND_URL (default http://127.0.0.1:9000). En CI el workflow
 * .github/workflows/e2e.yml levanta el backend dentro del runner.
 */
import { request, expect, type APIRequestContext, type Page } from '@playwright/test';

const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:9000';
export const API = `${BACKEND_URL}/api`;

/**
 * El registro público sólo admite CLIENT y DRIVER (un ADMIN no puede
 * auto-registrarse). Para los flujos de admin se usa la cuenta que el backend
 * siembra en una BD vacía (database.ts). Se puede sobreescribir por env.
 */
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@test.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'password123';

export interface TestUser {
  email: string;
  password: string;
  name: string;
  role: 'CLIENT' | 'DRIVER' | 'ADMIN';
  token?: string;
  id?: number;
}

/**
 * Crea un usuario de test con email único. El sufijo sólo sirve para
 * identificar el test en los logs: siempre se añade un tag aleatorio para que
 * los proyectos (chromium, firefox, ...) y los reintentos que corren en
 * paralelo contra el mismo backend no compartan cuenta ni solicitudes.
 */
export function makeUser(role: 'CLIENT' | 'DRIVER', suffix?: string): TestUser {
  const rand = Math.random().toString(36).slice(2, 8);
  const tag = suffix ? `${suffix}-${rand}` : rand;
  return {
    email: `e2e-${role.toLowerCase()}-${tag}@example.com`,
    password: 'TestPassword123!',
    name: `E2E ${role} ${tag}`,
    role,
  };
}

/** Admin sembrado por el backend (ver comentario de ADMIN_EMAIL). */
export function adminUser(): TestUser {
  return { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: 'Super Admin', role: 'ADMIN' };
}

async function login(api: APIRequestContext, user: TestUser): Promise<TestUser> {
  const res = await api.post(`${API}/auth/login`, {
    data: { email: user.email, password: user.password },
    failOnStatusCode: false,
  });
  if (!res.ok()) {
    throw new Error(`Login de ${user.email} falló: HTTP ${res.status()} ${await res.text()}`);
  }
  const body = await res.json();
  user.token = body.token;
  user.id = body.user?.id;
  return user;
}

export async function registerAndLogin(api: APIRequestContext, user: TestUser): Promise<TestUser> {
  if (user.role === 'ADMIN') return login(api, user);

  // Intenta registrar; si ya existe (409), sigue con login
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
  if (reg.status() !== 409) {
    throw new Error(`Registro de ${user.email} falló: HTTP ${reg.status()} ${await reg.text()}`);
  }
  return login(api, user);
}

export async function newApiContext(): Promise<APIRequestContext> {
  return await request.newContext({ baseURL: API });
}

/**
 * Login por la UI y espera a la ruta del rol. Envía el formulario con Enter:
 * en WebKit bajo carga el click a veces espera indefinidamente a que el botón
 * esté "estable" (animación de entrada de la tarjeta). El click en el botón ya
 * lo cubren los tests de login de client-flows.
 */
export async function loginViaUi(page: Page, user: TestUser, expectedPath: RegExp): Promise<void> {
  await page.goto('/');
  await page.getByPlaceholder(/tu@email\.com/i).fill(user.email);
  const password = page.getByPlaceholder(/mínimo 6 caracteres/i);
  await password.fill(user.password);
  await password.press('Enter');
  await page.waitForURL(expectedPath);
}

/**
 * En modo demo (VITE_DEMO_MODE=true) el panel del conductor usa una posición
 * aleatoria de Las Palmas y la muestra en la tarjeta GPS ("28.1234, -15.4321").
 * Devuelve esa posición para poder crear solicitudes justo donde está el
 * conductor (el backend sólo le ofrece las que caen dentro de su radio).
 */
export async function readDriverPosition(page: Page): Promise<{ lat: number; lon: number }> {
  const coords = page.getByText(/^-?\d+\.\d{4}, -?\d+\.\d{4}$/).first();
  await expect(coords).toBeVisible({ timeout: 15000 });
  const [lat, lon] = (await coords.innerText()).split(',').map((v) => Number(v.trim()));
  return { lat, lon };
}
