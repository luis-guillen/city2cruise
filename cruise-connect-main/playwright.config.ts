/**
 * Hito 6.2.1 — Playwright config (multi-browser + CI).
 *
 * Projects: chromium, firefox, webkit (Safari).
 * webServer: arranca `vite preview` (build prod) automáticamente.
 *
 * Para correr localmente:
 *   npm run build && npx playwright install && npx playwright test
 *
 * En CI (.github/workflows/e2e.yml):
 *   - usa BASE_URL apuntando al staging deployado (no auto-server)
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT || 4173);
const BASE_URL = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e/tests',
  outputDir: './e2e/.results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: './e2e/.report', open: 'never' }],
    ['junit', { outputFile: './e2e/.results/junit.xml' }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'es-ES',
    timezoneId: 'Atlantic/Canary',
    geolocation: { latitude: 28.1235, longitude: -15.4363 },  // Las Palmas
    permissions: ['geolocation'],
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    // Mobile viewports para validar responsive
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
  // Sólo arranca webServer si no hay BASE_URL externo
  webServer: process.env.BASE_URL ? undefined : {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
