/**
 * Hito 6.2.5 — E2E integración cliente+conductor en paralelo (multi-context).
 *
 * Simula el flow completo:
 *   1. Cliente y conductor logged en contextos separados (browser independientes)
 *   2. Cliente crea pickup (UI + pago demo)
 *   3. Conductor recibe via socket y acepta
 *   4. Cliente ve estado actualizado a "Encuentro" (CONFIRMATION_PENDING)
 *
 * Esta es la prueba más completa: depende de WebSocket bidireccional.
 */
import { test, expect, type BrowserContext } from '@playwright/test';
import {
  makeUser, registerAndLogin, newApiContext, loginViaUi, readDriverPosition, type TestUser,
} from '../fixtures/auth';

const BACKEND_AVAILABLE = !!process.env.BACKEND_URL || process.env.CI === 'true';

async function loginInContext(ctx: BrowserContext, user: TestUser, expectedPath: RegExp) {
  const page = await ctx.newPage();
  await loginViaUi(page, user, expectedPath);
  return page;
}

test.describe('Hito 6.2.5 — Integración cliente↔conductor (real-time)', () => {
  test.skip(!BACKEND_AVAILABLE, 'Necesita backend up');

  test('cliente crea request, driver recibe y acepta, ambos ven actualizaciones', async ({ browser }) => {
    // La cascada de búsqueda reintenta cada ~17 s; dar margen.
    test.setTimeout(120_000);

    const api = await newApiContext();
    const client = await registerAndLogin(api, makeUser('CLIENT', 'rt-c'));
    const driver = await registerAndLogin(api, makeUser('DRIVER', 'rt-d'));

    // Dos contextos aislados (cookies/localStorage separados). Se bloquea el
    // service worker de la PWA: las peticiones que pasan por él no las ve
    // page.route(), y aquí hace falta simular el geocoder.
    const ctxClient = await browser.newContext({
      geolocation: { latitude: 28.1235, longitude: -15.4363 },
      permissions: ['geolocation'],
      serviceWorkers: 'block',
    });
    const ctxDriver = await browser.newContext({
      geolocation: { latitude: 28.1240, longitude: -15.4360 },
      permissions: ['geolocation'],
      serviceWorkers: 'block',
    });

    try {
      // El conductor entra primero y publica su posición (demo: punto aleatorio de Las Palmas)
      const pageDriver = await loginInContext(ctxDriver, driver, /\/driver/);
      const pos = await readDriverPosition(pageDriver);

      // En modo demo la posición del cliente también es aleatoria. Para que la
      // solicitud caiga dentro del radio del conductor, el cliente elige la
      // recogida con el buscador; la respuesta del geocoder (Nominatim, externo)
      // se simula con la posición del conductor.
      const pageClient = await loginInContext(ctxClient, client, /\/client/);
      await pageClient.route('**/api/locations/search**', (route) =>
        route.fulfill({ json: [{ displayName: 'Punto E2E junto al conductor', lat: pos.lat, lon: pos.lon }] }),
      );
      await pageClient.getByPlaceholder(/buscar ubicación de recogida/i).fill('Punto E2E');
      await pageClient.getByRole('button', { name: /punto e2e junto al conductor/i }).click();

      // Cliente crea request + pago demo
      await pageClient.getByRole('button', { name: /continuar al pago/i }).click();
      await pageClient.getByRole('button', { name: /simular pago/i }).click();
      await expect(pageClient.getByText(/estamos buscando un driver/i)).toBeVisible({ timeout: 10_000 });

      // Driver ve el nuevo request de ESTE cliente en su panel (vía socket) y lo acepta
      const card = pageDriver.locator('div').filter({ hasText: client.name })
        .filter({ has: pageDriver.getByRole('button', { name: /^aceptar$/i }) }).last();
      const acceptBtn = card.getByRole('button', { name: /^aceptar$/i });
      await expect(acceptBtn).toBeVisible({ timeout: 45_000 });
      await acceptBtn.click();

      // Cliente ve el estado actualizado (vía socket): paso de encuentro con el conductor
      await expect(pageClient.getByRole('button', { name: /confirmar encuentro/i })).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctxClient.close();
      await ctxDriver.close();
    }
  });

  test('cliente recibe código de locker cuando driver deposita', async () => {
    test.skip(true, 'Implementación completa requiere mock del cierre del locker — deferred');
  });
});
