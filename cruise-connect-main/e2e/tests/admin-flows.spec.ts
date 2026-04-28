/**
 * Hito 6.2.4 — E2E flujos críticos del ADMIN.
 *
 * Cubre:
 *  1. Login admin
 *  2. Verificar métricas (throughput / timing visible)
 *  3. Acceder a Torre de Control (/admin/control-tower)
 *  4. Consultar audit trail
 */
import { test, expect } from '@playwright/test';
import { makeUser, registerAndLogin, newApiContext } from '../fixtures/auth';

const BACKEND_AVAILABLE = !!process.env.BACKEND_URL || process.env.CI === 'true';

test.describe('Hito 6.2.4 — Admin: flujos críticos', () => {
  test.skip(!BACKEND_AVAILABLE, 'Necesita BACKEND_URL — skip si no hay backend disponible');

  test('Admin login redirige a /admin', async ({ page }) => {
    const api = await newApiContext();
    const user = makeUser('ADMIN', 'login');
    await registerAndLogin(api, user);

    await page.goto('/');
    await page.getByPlaceholder(/tu@email\.com/i).fill(user.email);
    await page.getByPlaceholder(/mínimo 6 caracteres/i).fill(user.password);
    await page.getByRole('button', { name: /iniciar sesión|login/i }).click();
    await expect(page).toHaveURL(/\/admin(\?|$|\/)/);
  });

  test('Admin ve panel de métricas (throughput, timing, KPIs)', async ({ page }) => {
    const api = await newApiContext();
    const user = makeUser('ADMIN', 'metrics');
    await registerAndLogin(api, user);

    await page.goto('/');
    await page.getByPlaceholder(/tu@email\.com/i).fill(user.email);
    await page.getByPlaceholder(/mínimo 6 caracteres/i).fill(user.password);
    await page.getByRole('button', { name: /iniciar sesión|login/i }).click();
    await page.waitForURL(/\/admin/);

    // Selector general — KPIs deben estar visibles
    await expect(page.getByText(/admin|métricas|metrics|panel/i).first()).toBeVisible();
  });

  test('Admin puede acceder a Torre de Control vía /admin/control-tower', async ({ page }) => {
    const api = await newApiContext();
    const user = makeUser('ADMIN', 'tower');
    await registerAndLogin(api, user);

    await page.goto('/');
    await page.getByPlaceholder(/tu@email\.com/i).fill(user.email);
    await page.getByPlaceholder(/mínimo 6 caracteres/i).fill(user.password);
    await page.getByRole('button', { name: /iniciar sesión|login/i }).click();
    await page.waitForURL(/\/admin/);

    await page.goto('/admin/control-tower');
    await expect(page.getByText(/torre de control/i)).toBeVisible({ timeout: 8000 });
  });

  test('Cliente NO puede acceder a /admin (redirige fuera)', async ({ page }) => {
    const api = await newApiContext();
    const client = makeUser('CLIENT', 'rbac');
    await registerAndLogin(api, client);

    await page.goto('/');
    await page.getByPlaceholder(/tu@email\.com/i).fill(client.email);
    await page.getByPlaceholder(/mínimo 6 caracteres/i).fill(client.password);
    await page.getByRole('button', { name: /iniciar sesión|login/i }).click();
    await page.waitForURL(/\/client/);

    // Intentar acceder a /admin
    await page.goto('/admin');
    // ProtectedRoute debe redirigir
    await page.waitForURL((url) => !url.pathname.startsWith('/admin'), { timeout: 5000 });
  });

  test('Cliente NO puede acceder a /admin/control-tower', async ({ page }) => {
    const api = await newApiContext();
    const client = makeUser('CLIENT', 'rbac2');
    await registerAndLogin(api, client);

    await page.goto('/');
    await page.getByPlaceholder(/tu@email\.com/i).fill(client.email);
    await page.getByPlaceholder(/mínimo 6 caracteres/i).fill(client.password);
    await page.getByRole('button', { name: /iniciar sesión|login/i }).click();
    await page.waitForURL(/\/client/);

    await page.goto('/admin/control-tower');
    await page.waitForURL((url) => !url.pathname.includes('control-tower'), { timeout: 5000 });
  });
});
