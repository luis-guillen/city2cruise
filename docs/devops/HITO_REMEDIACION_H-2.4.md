# Hito H-2.4 — ESLint dedicado al backend (I-01)

**Severidad:** INFO
**Owner:** Backend
**Esfuerzo:** ~2 horas
**Estado:** ✅ Cerrado

## Cambios

### `backend/eslint.config.mjs` (nuevo)

Flat config (ESLint 9), parser con type-info contra `tsconfig.eslint.json`,
cuatro reglas duras:

| Regla | Nivel | Razón |
| --- | --- | --- |
| `@typescript-eslint/no-floating-promises` | `error` | Promesas sin `await/.catch/void` (I-01). |
| `@typescript-eslint/no-misused-promises` | `error` | Pasar Promise donde se espera void (callbacks de timers, handlers Express, etc.). |
| `@typescript-eslint/no-explicit-any` | `warn` | Visibilidad sin bloquear; H-5.x lo subirá. |
| `no-console` | `warn` | Será `error` tras H-2.2 (codemod a logger). |

Las demás reglas del preset `recommendedTypeChecked` (`no-unsafe-*`,
`restrict-template-expressions`, etc.) se posponen a H-5.x para no
bloquear el cierre del Capítulo 2 con warnings preexistentes.

### `backend/tsconfig.eslint.json` (nuevo)

Extiende `tsconfig.json` y excluye `__tests__/` para que el parser type-info
no cargue las suites jest al lint (más rápido).

### `backend/package.json`

```json
"scripts": {
  "lint": "eslint src",
  "lint:strict": "eslint src --max-warnings=0"
}
```

`lint` es el gate en CI (0 errors). `lint:strict` queda para H-5.x.

### `.github/workflows/ci.yml`

Paso `Lint (eslint, H-2.4 / I-01)` en el job `backend`, después de `Install`
y antes del `tsc --noEmit`.

## Bugs reales detectados y arreglados

ESLint encontró 4 promesas mal manejadas. Todas corregidas:

| Fichero | Línea | Tipo | Arreglo |
| --- | --- | --- | --- |
| `src/jobs/pickupReminderJob.ts` | 36 | `no-misused-promises` | `setInterval(() => { run().catch(()=>{}); }, ...)` en lugar de pasar la función async directamente. |
| `src/services/GeoDispatchService.ts` | 152 | `no-misused-promises` | `setTimeout(() => { runCascade(next).catch(err => logger.error(...)); }, delay)`. |
| `src/services/LockerSyncService.ts` | 90 | `no-misused-promises` | mismo patrón de wrap del setInterval. |
| `src/sockets/io.ts` | 166 | `no-floating-promises` | `void socket.join(roomName)` (en cluster mode socket.io devuelve Promise). |

## Evidencia

```
$ cd backend && npx eslint src
✖ 72 problems (0 errors, 72 warnings)   ← 0 errors, exit 0

$ cd backend && npx eslint src --quiet
(silencio, sin errores)

$ cd backend && npx jest src/__tests__/env.test.ts src/__tests__/cors.test.ts \
                       --silent --no-coverage
Tests: 10 passed, 10 total

$ cd backend && npx tsc --noEmit
(sin errores)
```

## Trazabilidad

- Auditoría: hallazgo `I-01`.
- Hoja de ruta: capítulo 2, hito H-2.4.
- Tag: `hito-H-2.4-completed`.
