# Hito H-4.1 — Actualizar Vite ≥ 6 + vite-plugin-pwa compatible (S-05)

**Severidad:** MEDIO
**Owner:** Frontend
**Esfuerzo:** ~0.5 jornada
**Estado:** ✅ Cerrado

## Cambios en `cruise-connect-main/package.json`

### `devDependencies`

- `vite`: `^5.4.20` → `^6.0.0` (resuelto en `6.4.2`).
- `vite-plugin-pwa`: `^0.20.5` → `^1.0.0` (resuelto en `1.2.0`).

### `overrides`

- `vite`: `5.4.21` → `^6.0.0`.
- `vite-plugin-pwa`: `0.20.5` → `^1.0.0`.
- `follow-redirects`: nuevo, `^1.16.0` (cierra el último moderate residual,
  publicado tras H-1.2 — leak de Authorization headers en redirects
  cross-domain).

## Advisories cerradas

| Severidad | Antes (post-H-1.2) | Después (post-H-4.1) |
| --- | ---: | ---: |
| critical | 0 | 0 |
| high     | 0 | 0 |
| moderate | 10 | **0** |
| low      | 0 | 0 |
| info     | 0 | 0 |

Las 10 moderates barridas por este hito eran:

| Paquete | Origen | Cerrada por |
| --- | --- | --- |
| `esbuild` | transitiva de vite | vite ^6.0.0 (`GHSA-67mh-4wv8-2f99`). |
| `vite` <=6.4.1 | dev | bump a 6.4.2. |
| `@vitejs/plugin-react-swc` <=3.7.1 | dev | propaga vite 6, deduped. |
| `@vitest/mocker` | transitiva | propaga vite 6. |
| `lovable-tagger` | dev | propaga vite 6. |
| `vite-plugin-pwa` <=0.21.2 | dev | bump a 1.2.0. |
| `@vitest/coverage-v8` | transitiva | propaga vitest 3.2.4 + vite 6. |
| `vite-node` | transitiva | propaga vite 6. |
| `vitest` | dev | sin bump (3.2.4 ya soporta vite 6). |
| `follow-redirects` <=1.15.11 | transitiva (axios) | override a `^1.16.0`. |

## Compatibilidad

- `vite-plugin-pwa@1.2.0` declara peer `vite ^3.1.0 || ^4 || ^5 || ^6 || ^7`.
- `vitest@3.2.4` declara `vite: ^5 || ^6 || ^7` como dependencia regular.
- `@vitejs/plugin-react-swc@3.11.0` declara peer `vite ^4 || ^5 || ^6 || ^7 || ^8`.

Todos validan vite 6 sin cambios mayores; no se ha tocado `vite.config.ts`.

## Verificación

```
$ npm audit                       → 0 vulnerabilidades en cualquier severidad.
$ npm audit --audit-level=high    → exit 0, 0 vulnerabilities.
$ npm audit --audit-level=moderate → exit 0, 0 vulnerabilities.
$ npm ls vite vite-plugin-pwa     → vite@6.4.2 / vite-plugin-pwa@1.2.0 (overridden).
$ npx tsc --noEmit                → 0 errors.
$ npx vitest run                  → 22 suites, 127/127 tests passed.
$ npm run build                   → built in 8.97 s, PWA v1.2.0, precache 24 entries.
$ ls dist/manifest.webmanifest dist/sw.js → presentes; PWA generada.
```

Bundle entry: 35.1 KB raw / 12.1 KB gzip — sin cambio sensible vs.
post-H-1.2 (~+0,1 %).

Evidencia: `docs/devops/audits/post-h41/audit-frontend-post-h41.json`.

## Trazabilidad

- Auditoría: hallazgo `S-05`.
- Hoja de ruta: capítulo 4, hito H-4.1.
- Tag: `hito-H-4.1-completed`.
