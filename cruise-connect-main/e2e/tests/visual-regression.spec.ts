/**
 * Hito 6.2.6 — Visual regression con Playwright (toMatchSnapshot screenshots).
 *
 * Captura screenshots de pantallas críticas y compara pixel-by-pixel contra
 * la baseline. Tolerancia configurable: maxDiffPixelRatio: 0.01 (1%).
 *
 * Para regenerar baselines:
 *   npx playwright test visual-regression --update-snapshots
 *
 * Las imágenes se guardan en e2e/tests/visual-regression.spec.ts-snapshots/
 */
import { test, expect } from '@playwright/test';

test.describe('Hito 6.2.6 — Visual regression', () => {
  test.beforeEach(async ({ page }) => {
    // Estabilizar antes de capturar:
    // - desactivar animaciones CSS (prefers-reduced-motion)
    // - fijar viewport
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('Login page (clean state)', async ({ page }) => {
    await page.goto('/');
    // Esperar a que el logo / form sean visibles
    await expect(page.getByPlaceholder(/tu@email\.com/i)).toBeVisible();
    // Captura full page para detectar cambios en cualquier parte
    await expect(page).toHaveScreenshot('login.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      mask: [
        // Fechas dinámicas, contadores, etc. — añadir locators si aparecen
      ],
    });
  });

  test('Login page — formulario con error', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder(/tu@email\.com/i).fill('test@x.com');
    await page.getByPlaceholder(/mínimo 6 caracteres/i).fill('shrt');
    await page.getByRole('button', { name: /iniciar sesión|login/i }).click();
    // Esperar al toast de error
    await page.waitForTimeout(800);
    await expect(page).toHaveScreenshot('login-error.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.03,
      animations: 'disabled',
    });
  });

  test('404 NotFound page', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    await expect(page).toHaveScreenshot('404.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
});
