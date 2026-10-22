/**
 * Hito 6.2.3 — E2E flujos críticos del CONDUCTOR.
 *
 * Cubre:
 *  1. Login como driver
 *  2. Ver pendientes
 *  3. Aceptar pickup request
 *  4. Ver el código de handshake tras aceptar
 */
import { test, expect } from '@playwright/test';
import {
  API, makeUser, registerAndLogin, newApiContext, loginViaUi, readDriverPosition,
} from '../fixtures/auth';

const BACKEND_AVAILABLE = !!process.env.BACKEND_URL || process.env.CI === 'true';

test.describe('Hito 6.2.3 — Conductor: flujos críticos', () => {
  test.skip(!BACKEND_AVAILABLE, 'Necesita BACKEND_URL — skip si no hay backend disponible');

  test('Driver login redirige a /driver dashboard', async ({ page }) => {
    const api = await newApiContext();
    const user = await registerAndLogin(api, makeUser('DRIVER', 'login'));

    await loginViaUi(page, user, /\/driver/);
    await expect(page).toHaveURL(/\/driver/);
  });

  test('Driver ve panel de pickups pendientes (lista vacía o con items)', async ({ page }) => {
    const api = await newApiContext();
    const user = await registerAndLogin(api, makeUser('DRIVER', 'pending'));

    await loginViaUi(page, user, /\/driver/);

    await expect(page.getByText(/solicitudes pendientes \(\d+\)/i)).toBeVisible();
  });

  test('Driver acepta request creado por cliente vía API y aparece en su panel', async ({ page }) => {
    // La cascada de búsqueda reintenta cada ~17 s; dar margen.
    test.setTimeout(90_000);

    const api = await newApiContext();
    const driver = await registerAndLogin(api, makeUser('DRIVER', 'accept'));

    // 1. El conductor entra y publica su posición (demo: punto de Las Palmas)
    await loginViaUi(page, driver, /\/driver/);
    const pos = await readDriverPosition(page);

    // 2. Un cliente crea una solicitud justo donde está el conductor
    const client = await registerAndLogin(api, makeUser('CLIENT', 'src'));
    const reqResp = await api.post(`${API}/requests`, {
      headers: { Authorization: `Bearer ${client.token}` },
      data: {
        pickupLocation: `E2E ${client.name}`,
        latitude: pos.lat,
        longitude: pos.lon,
        packageSize: 'SMALL',
      },
    });
    expect(reqResp.ok(), await reqResp.text()).toBeTruthy();

    // 3. Le llega por socket y la acepta (la de este cliente, no otra en paralelo)
    const card = page.locator('div').filter({ hasText: client.name })
      .filter({ has: page.getByRole('button', { name: /^aceptar$/i }) }).last();
    const acceptBtn = card.getByRole('button', { name: /^aceptar$/i });
    await expect(acceptBtn).toBeVisible({ timeout: 45_000 });
    await acceptBtn.click();

    // 4. Aparece el código de handshake para el cliente
    await expect(page.getByText(/código para el cliente/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('Driver con request asignado puede ver ETA y locker destino', async () => {
    test.skip(true, 'Requiere setup completo de cascade — implementar tras 6.2.5');
  });
});
