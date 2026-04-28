# Hito 6.2 — E2E con Playwright (multi-browser + visual regression)

> Status: **Done** (2026-04-28)
> Fase: 6.2 — Testing E2E

## Setup (Hito 6.2.1)

| Archivo | Función |
|---|---|
| `cruise-connect-main/playwright.config.ts` | 4 projects (chromium/firefox/webkit/mobile-chrome), webServer auto, geo Las Palmas, locale es-ES, html+junit reporters |
| `cruise-connect-main/e2e/fixtures/auth.ts` | makeUser, registerAndLogin, newApiContext (helpers) |
| `.github/workflows/e2e.yml` | Job CI: install browsers, build, run e2e, upload report+junit |
| `package.json` scripts | `e2e`, `e2e:ui`, `e2e:debug`, `e2e:install`, `e2e:report` |

## Tests por flujo

### 6.2.2 — Cliente (`client-flows.spec.ts`)
- Registro de nuevo cliente
- Login válido → `/client`
- Login inválido → toast error
- Crear pickup request con geolocation Las Palmas
- Historial vacío al inicio

### 6.2.3 — Conductor (`driver-flows.spec.ts`)
- Driver login → `/driver`
- Panel pendientes visible
- Aceptar request creado por cliente vía API

### 6.2.4 — Admin (`admin-flows.spec.ts`)
- Admin login → `/admin`
- Métricas visibles
- Acceso a `/admin/control-tower`
- Cliente NO accede a `/admin` (RBAC)
- Cliente NO accede a `/admin/control-tower` (RBAC)

### 6.2.5 — Multi-context real-time (`multi-context-realtime.spec.ts`)
- Dos browser contexts aislados (cliente + conductor)
- Cliente crea pickup → conductor lo recibe vía socket
- Conductor acepta → cliente ve "Aceptado" vía socket

### 6.2.6 — Visual regression (`visual-regression.spec.ts`)
- Login limpio
- Login con error
- 404 NotFound
- Tolerancia 2-3% pixel diff, animaciones disabled

## Cómo ejecutar

```bash
cd cruise-connect-main

# Setup inicial (una vez)
npm install --legacy-peer-deps
npx playwright install --with-deps

# Ejecutar todo (3 browsers + mobile)
npm run e2e

# Modo UI interactivo
npm run e2e:ui

# Sólo un proyecto
npx playwright test --project=chromium

# Sólo un test
npx playwright test client-flows

# Actualizar snapshots visuales
npx playwright test --update-snapshots

# Ver report HTML
npm run e2e:report
```

## Variables de entorno

| Variable | Para qué |
|---|---|
| `BASE_URL` | Si está set, NO arranca webServer local — usa esa URL (ej. staging) |
| `BACKEND_URL` | URL del backend para fixtures (default `http://127.0.0.1:9000`) |
| `CI` | Si está set, retries=2 + workers=2 + forbidOnly |

## Skips inteligentes

Los tests que requieren backend usan `test.skip(!BACKEND_AVAILABLE)`. Esto
permite ejecutar Playwright en CI:
- **PR contra develop/main** (sin staging desplegado): solo smoke + visual.
- **workflow_dispatch con base_url**: ejecuta TODO contra staging real.

## Limitaciones conocidas

- Webkit en Linux requiere paquetes adicionales (los instala
  `playwright install --with-deps` automáticamente).
- Visual regression baselines son específicas del SO renderer. CI debe
  generar las baselines en Ubuntu para que coincidan.
- WebSocket reconnection bajo carga no está testado aquí — eso es Hito 6.4.3.

## Próximo

Hito 6.3 — Tests de seguridad (OWASP ZAP, RBAC, rate-limiting).
