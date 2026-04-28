# Hito 4.1.1 — Auditoría de Accesibilidad (WCAG 2.1 AA)

> Fecha: 2026-04-28
> Rama: `FASE4-FASE5-FASE6`
> Ámbito: frontend `cruise-connect-main` (React 18 + Vite + shadcn/ui + Leaflet)

## 1. Metodología

La auditoría se ejecuta en dos capas complementarias:

| Capa | Herramienta | Qué cubre | Limitaciones |
|---|---|---|---|
| **Estática (CI)** | `vitest` + `axe-core` vía `vitest-axe` | Estructura semántica, ARIA, labels, landmarks, focus order, names | jsdom no implementa `<canvas>` → no calcula contraste de color real |
| **Dinámica (manual)** | Lighthouse 12 (Chrome headless) | Score WCAG 2.1 AA completo, contraste, color, tap targets, document language | Necesita backend + frontend levantados |

### Comandos

```bash
# Auditoría estática (corre en cada test run)
npm test -- src/__tests__/a11y

# Auditoría estática estricta (rompe la build con ≥1 violación)
A11Y_STRICT=1 npm test -- src/__tests__/a11y

# Auditoría dinámica (Lighthouse) — requiere `npm run dev` corriendo
./scripts/a11y-lighthouse.sh
BASE_URL=http://localhost:9100 MIN_SCORE=90 ./scripts/a11y-lighthouse.sh
```

Reportes generados:
- `docs/audits/a11y-results.json` — salida axe-core
- `docs/audits/lighthouse/{ruta}.html` — reportes Lighthouse por ruta
- `docs/audits/lighthouse/summary.json` — resumen por URL

## 2. Resultados de la baseline (2026-04-28)

### 2.1 axe-core (vitest-axe)

| Scope | Violaciones | Nivel |
|---|---:|---|
| `pages/LoginPage` | 0 ✓ | — |
| `pages/NotFound` | 0 ✓ | — |
| `components/ui/primitives` (Button/Input/Card/Badge) | 0 ✓ | — |
| `components/StatusBadge` (todos los estados) | 0 ✓ | — |

> **Nota importante**: el 0/0 en jsdom **no implica** cumplimiento real de WCAG.
> axe en jsdom no puede inspeccionar contraste cromático ni verificar tap-target
> sizes calculados por layout. Por eso el reporte de Lighthouse manda.

### 2.2 Hallazgos detectados por inspección de código

Identificados tras revisión manual + análisis estático del bundle:

#### Severidad ALTA (deben arreglarse en Hitos 4.1.2 / 4.1.3)

| ID | Componente | Issue | Norma WCAG |
|---|---|---|---|
| H-01 | `index.html` | `<html lang="en">` con app en español → asistivos pronuncian mal | 3.1.1 |
| H-02 | `LoginPage.tsx` | Blobs decorativos sin `aria-hidden="true"` | 1.3.1 |
| H-03 | `LoginPage.tsx` | Logo decorativo `<Ship />` sin texto alternativo si se usa solo | 1.1.1 |
| H-04 | `Navbar.tsx` | Botón "Salir" no tiene `type="button"` (puede submitear forms vecinos) | best-practice |
| H-05 | Glass morphism (`GlassCard`, `GlassInput`, etc.) | Probable contraste < 4.5:1 sobre fondos claros con `bg-card/80 backdrop-blur` | 1.4.3 |
| H-06 | `ClientTrackingMap` / `DriverMap` | Mapa Leaflet sin `role="application"` ni `aria-label` ni vista alternativa textual | 1.1.1 / 1.3.1 |
| H-07 | `NotificationBell.tsx` | Botón con icono sin nombre accesible (necesita `aria-label`) | 4.1.2 |

#### Severidad MEDIA

| ID | Componente | Issue | Norma WCAG |
|---|---|---|---|
| M-01 | `Layout.tsx` | `<main>` no tiene `id="main"` ni hay skip-link | 2.4.1 |
| M-02 | Toda la app | Tap target en botones de iconos < 44×44px en móvil | 2.5.5 |
| M-03 | Forms (`LoginPage`) | Errores via `toast` (Sonner) → no se anuncian a screen reader como `aria-live="assertive"` por defecto | 4.1.3 |
| M-04 | `GlassSegmented` | No es un `tablist`/`radiogroup` ARIA → SR no indica selección | 4.1.2 |
| M-05 | App | No hay focus visible custom; depende del default del navegador, suele ser invisible sobre glass | 2.4.7 |

#### Severidad BAJA

| ID | Componente | Issue | Norma WCAG |
|---|---|---|---|
| L-01 | App | No hay `prefers-reduced-motion` honrado en blobs y `animate-slide-*` | 2.3.3 |
| L-02 | App | Faltan landmarks `<aside>` y `<section aria-labelledby>` en dashboards | 1.3.1 |
| L-03 | i18n | App fija "Bienvenido" / "Salir" en español → sin extracción i18n para SR multilingües | 3.1.2 |

### 2.3 Mapeo a perfiles BD (`profile`)

La tabla `users.profile` ya contempla 3 perfiles que el frontend **no usa todavía**:

| Perfil BD | Significado | Aplicado en Hito | Tareas concretas |
|---|---|---|---|
| `standard` | Default | 4.1.3 | Asegurar baseline WCAG AA |
| `age_advanced` | Personas mayores | 4.1.4 | Fuentes ≥18px, tap targets ≥48px, copy simplificado, menos pasos |
| `pmr` | Movilidad reducida | 4.1.5 | Lectores de pantalla, vista alternativa al mapa, vibración fuerte/sonido en eventos clave |

## 3. Plan de remediación

| Hito | Issues que cierra | ETA |
|---|---|---|
| 4.1.2 (Semántica + ARIA + teclado) | H-04, H-06, H-07, M-01, M-04, M-05, L-02 | 1d |
| 4.1.3 (Contraste glass morphism) | H-05, M-03 | 1d |
| 4.1.4 (Perfil age_advanced) | M-02 (touch target ≥48px en perfil), copy simplificado | 1d |
| 4.1.5 (Perfil PMR) | M-03 (live region), vista alternativa al mapa | 1d |
| 4.1.6 (i18n) | H-01, L-03 | 1d |

## 4. Criterios de aceptación de la Fase 4.1

- [ ] `npm test -- src/__tests__/a11y` corre con `A11Y_STRICT=1` sin violaciones
- [ ] `./scripts/a11y-lighthouse.sh` da score Lighthouse a11y **≥ 90** en `/`, `/client`, `/driver`, `/admin`
- [ ] Toda la interfaz es navegable únicamente con `Tab` / `Shift+Tab` / `Enter` / `Space` / `Esc`
- [ ] Selector de idioma persistente en navbar con al menos 5 idiomas (ES / EN / FR / DE / IT)
- [ ] Perfil `age_advanced` aplica tokens ampliados de forma global cuando se selecciona

## 5. Anexos

- `a11y-results.json` (salida cruda axe-core)
- `lighthouse/*.html` (reportes detallados por ruta)
- `cruise-connect-main/src/__tests__/a11y/audit.a11y.test.tsx` (test runner)
