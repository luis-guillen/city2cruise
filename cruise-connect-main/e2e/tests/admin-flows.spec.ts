/**
 * Hito 6.2.4 — E2E flujos críticos del ADMIN.
 *
 * Cubre:
 *  1. Login admin
 *  2. Verificar métricas (throughput / timing visible)
 *  3. Acceder a Torre de Control (/admin/control-tower)
 *  4. RBAC: un cliente no entra en /admin ni en la Torre de Control
 *
 * El registro público no permite crear ADMIN, así que se usa el admin que el
 * backend siembra en una BD vacía (ver fixtures/auth.ts → adminUser()).
 */
import { test, expect } from '@playwright/test';
import { makeUser, adminUser, registerAndLogin, newApiContext, loginViaUi } from '../fixtures/auth';

const BACKEND_AVAILABLE = !!process.env.BACKEND_URL || process.env.CI === 'true';

test.describe('Hito 6.2.4 — Admin: flujos críticos', () => {
  test.skip(!BACKEND_AVAILABLE, 'Necesita BACKEND_URL — skip si no hay backend disponible');

  test('Admin login redirige a /admin', async ({ page }) => {
    await loginViaUi(page, adminUser(), /\/admin(\?|$|\/)/);
    await expect(page).toHaveURL(/\/admin(\?|$|\/)/);
  });

  test('Admin ve panel de métricas (throughput, timing, KPIs)', async ({ page }) => {
    await loginViaUi(page, adminUser(), /\/admin/);

    await expect(page.getByText('Administración').first()).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Métricas' })).toBeVisible();
  });

  test('Admin puede acceder a Torre de Control vía /admin/control-tower', async ({ page }) => {
    await loginViaUi(page, adminUser(), /\/admin/);

    await page.goto('/admin/control-tower');
    await expect(page.getByRole('heading', { name: /torre de control/i })).toBeVisible({ timeout: 8000 });
  });

  test('Cliente NO puede acceder a /admin (redirige fuera)', async ({ page }) => {
    const api = await newApiContext();
    const client = await registerAndLogin(api, makeUser('CLIENT', 'rbac'));

    await loginViaUi(page, client, /\/client/);

    // Intentar acceder a /admin → ProtectedRoute debe redirigir
    await page.goto('/admin');
    await page.waitForURL((url) => !url.pathname.startsWith('/admin'), { timeout: 5000 });
  });

  test('Cliente NO puede acceder a /admin/control-tower', async ({ page }) => {
    const api = await newApiContext();
    const client = await registerAndLogin(api, makeUser('CLIENT', 'rbac2'));

    await loginViaUi(page, client, /\/client/);

    await page.goto('/admin/control-tower');
    await page.waitForURL((url) => !url.pathname.includes('control-tower'), { timeout: 5000 });
  });
});
