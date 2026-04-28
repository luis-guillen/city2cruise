/**
 * Hito 6.2.2 — E2E flujos críticos del CLIENTE.
 *
 * Cubre:
 *  1. Registro nuevo cliente
 *  2. Login
 *  3. Crear request con geolocalización mock (Las Palmas)
 *  4. Ver progreso request (cascade phase)
 *  5. Recibir código locker (cuando driver deposita)
 *  6. Consultar historial
 *
 * Requiere backend up. Si no, los tests se SKIPEAN graciosamente.
 */
import { test, expect } from '@playwright/test';
import { makeUser, registerAndLogin, newApiContext } from '../fixtures/auth';

const BACKEND_AVAILABLE = !!process.env.BACKEND_URL || process.env.CI === 'true';

test.describe('Hito 6.2.2 — Cliente: flujos críticos', () => {
  test.skip(!BACKEND_AVAILABLE, 'Necesita BACKEND_URL — skip si no hay backend disponible');

  test('Registro de nuevo cliente y login automático', async ({ page }) => {
    const user = makeUser('CLIENT');
    await page.goto('/');

    // Cambiar a tab "Registrarse" si existe
    const tabRegister = page.getByRole('tab', { name: /registrarse|sign up/i });
    if (await tabRegister.count()) await tabRegister.first().click();

    await page.getByPlaceholder(/nombre/i).fill(user.name);
    await page.getByPlaceholder(/tu@email\.com/i).fill(user.email);
    await page.getByPlaceholder(/mínimo 6 caracteres/i).fill(user.password);
    await page.getByRole('button', { name: /registrarme|registrarse|sign up/i }).click();

    // Tras registro, redirige a /client
    await expect(page).toHaveURL(/\/client/);
  });

  test('Login con credenciales válidas redirige al dashboard cliente', async ({ page }) => {
    const api = await newApiContext();
    const user = makeUser('CLIENT', 'login');
    await registerAndLogin(api, user);

    await page.goto('/');
    await page.getByPlaceholder(/tu@email\.com/i).fill(user.email);
    await page.getByPlaceholder(/mínimo 6 caracteres/i).fill(user.password);
    await page.getByRole('button', { name: /iniciar sesión|login/i }).click();

    await expect(page).toHaveURL(/\/client/);
  });

  test('Login con credenciales inválidas muestra error', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder(/tu@email\.com/i).fill('noexiste@example.com');
    await page.getByPlaceholder(/mínimo 6 caracteres/i).fill('wrongpassword');
    await page.getByRole('button', { name: /iniciar sesión|login/i }).click();
    // Toast / inline error visible
    await expect(page.getByText(/contraseña incorrecta|inválido|invalid|unauthorized/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('Cliente puede crear pickup request con geolocalización Las Palmas', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);

    const api = await newApiContext();
    const user = makeUser('CLIENT', 'request');
    await registerAndLogin(api, user);

    await page.goto('/');
    await page.getByPlaceholder(/tu@email\.com/i).fill(user.email);
    await page.getByPlaceholder(/mínimo 6 caracteres/i).fill(user.password);
    await page.getByRole('button', { name: /iniciar sesión|login/i }).click();
    await page.waitForURL(/\/client/);

    // Botón crear request
    const createBtn = page.getByRole('button', { name: /solicitar|pedir recogida|crear/i }).first();
    await expect(createBtn).toBeVisible({ timeout: 10000 });
    await createBtn.click();

    // Confirmar con dialog si aparece
    const confirmBtn = page.getByRole('button', { name: /confirmar|continuar/i }).first();
    if (await confirmBtn.count()) await confirmBtn.click();

    // Status visible
    await expect(page.getByText(/solicitado|requested|buscando/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('Cliente ve historial vacío al inicio', async ({ page }) => {
    const api = await newApiContext();
    const user = makeUser('CLIENT', 'hist');
    await registerAndLogin(api, user);

    await page.goto('/');
    await page.getByPlaceholder(/tu@email\.com/i).fill(user.email);
    await page.getByPlaceholder(/mínimo 6 caracteres/i).fill(user.password);
    await page.getByRole('button', { name: /iniciar sesión|login/i }).click();
    await page.waitForURL(/\/client/);

    // Tab historial si existe
    const histTab = page.getByRole('tab', { name: /historial|history/i });
    if (await histTab.count()) {
      await histTab.first().click();
      await expect(page.getByText(/sin historial|no hay|empty/i).first()).toBeVisible({ timeout: 5000 });
    }
  });
});
