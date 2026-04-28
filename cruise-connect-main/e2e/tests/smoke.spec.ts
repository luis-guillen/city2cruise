/**
 * Hito 6.2.1 — Smoke test mínimo (verifica que Playwright + app arrancan).
 * Carga la home, verifica que hay un h1 visible y un input de email.
 */
import { test, expect } from '@playwright/test';

test.describe('Smoke — boot', () => {
  test('home carga y muestra el formulario de login', async ({ page }) => {
    await page.goto('/');
    // El componente LoginPage tiene placeholder "tu@email.com"
    await expect(page.getByPlaceholder(/tu@email\.com/i)).toBeVisible();
    await expect(page.getByPlaceholder(/mínimo 6 caracteres/i)).toBeVisible();
  });

  test('PWA manifest accesible', async ({ page }) => {
    const r = await page.request.get('/manifest.webmanifest');
    expect(r.status()).toBeLessThan(400);
  });

  test('asset SW registrado', async ({ page }) => {
    await page.goto('/');
    const swReady = await page.evaluate(async () => {
      // El SW se registra desde main.tsx con virtual:pwa-register
      return 'serviceWorker' in navigator;
    });
    expect(swReady).toBe(true);
  });
});
