/**
 * Hito 6.2.2 — E2E flujos críticos del CLIENTE.
 *
 * Cubre:
 *  1. Registro nuevo cliente
 *  2. Login (válido e inválido)
 *  3. Crear solicitud con la ubicación demo de Las Palmas + pago demo
 *  4. Ver progreso de la solicitud (búsqueda de conductor)
 *  5. Consultar historial
 *
 * Requiere backend up. Si no, los tests se SKIPEAN graciosamente.
 */
import { test, expect } from '@playwright/test';
import { makeUser, registerAndLogin, newApiContext, loginViaUi } from '../fixtures/auth';

const BACKEND_AVAILABLE = !!process.env.BACKEND_URL || process.env.CI === 'true';

test.describe('Hito 6.2.2 — Cliente: flujos críticos', () => {
  test.skip(!BACKEND_AVAILABLE, 'Necesita BACKEND_URL — skip si no hay backend disponible');

  test('Registro de nuevo cliente y login automático', async ({ page }) => {
    const user = makeUser('CLIENT');
    await page.goto('/');

    // Selector "Iniciar sesión | Registrarse" (radiogroup, sólo en modo demo)
    await page.getByRole('radio', { name: /registrarse/i }).click();

    await page.getByPlaceholder(/tu nombre/i).fill(user.name);
    await page.getByPlaceholder(/tu@email\.com/i).fill(user.email);
    await page.getByPlaceholder(/mínimo 6 caracteres/i).fill(user.password);
    await page.getByRole('radio', { name: /cliente/i }).click();
    await page.getByRole('button', { name: /crear cuenta/i }).click();

    // Tras registro, redirige a /client
    await expect(page).toHaveURL(/\/client/);
  });

  test('Login con credenciales válidas redirige al dashboard cliente', async ({ page }) => {
    const api = await newApiContext();
    const user = await registerAndLogin(api, makeUser('CLIENT', 'login'));

    await loginViaUi(page, user, /\/client/);
    await expect(page).toHaveURL(/\/client/);
  });

  test('Login con credenciales inválidas muestra error', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder(/tu@email\.com/i).fill('noexiste@example.com');
    await page.getByPlaceholder(/mínimo 6 caracteres/i).fill('wrongpassword');
    await page.getByRole('button', { name: /iniciar sesión|login/i }).click();
    // Toast con el mensaje del backend ("Credenciales incorrectas")
    await expect(
      page.getByText(/credenciales incorrectas|contraseña incorrecta|inválido|invalid|unauthorized/i).first(),
    ).toBeVisible({ timeout: 5000 });
    await expect(page).not.toHaveURL(/\/client/);
  });

  test('Cliente puede crear pickup request con geolocalización Las Palmas', async ({ page }) => {
    const api = await newApiContext();
    const user = await registerAndLogin(api, makeUser('CLIENT', 'request'));

    await loginViaUi(page, user, /\/client/);

    // En modo demo la ubicación se autoselecciona ("Ubicación actual (GPS)")
    // y el botón se habilita cuando hay ubicación.
    const createBtn = page.getByRole('button', { name: /continuar al pago/i });
    await expect(createBtn).toBeEnabled({ timeout: 10000 });
    await createBtn.click();

    // Checkout demo (sin Stripe real)
    await page.getByRole('button', { name: /simular pago/i }).click();

    // Solicitud activa buscando conductor
    await expect(page.getByText(/estamos buscando un driver/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Solicitud activa')).toBeVisible();
  });

  test('Cliente ve historial vacío al inicio', async ({ page }) => {
    const api = await newApiContext();
    const user = await registerAndLogin(api, makeUser('CLIENT', 'hist'));

    await loginViaUi(page, user, /\/client/);

    await page.getByRole('radio', { name: /historial/i }).click();
    await expect(page.getByText(/sin historial/i).first()).toBeVisible({ timeout: 5000 });
  });
});
