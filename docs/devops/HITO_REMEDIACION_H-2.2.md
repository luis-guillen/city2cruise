# Hito H-2.2 — Migrar `console.log` al logger estructurado (S-08)

**Severidad:** BAJO
**Owner:** Cualquiera (codemod)
**Esfuerzo:** ~2 horas
**Estado:** ✅ Cerrado

## Inventario inicial

| Lugar | Hits | Notas |
| --- | ---: | --- |
| `backend/src/db/seed_lp.ts` | 19 | Script CLI, salida interactiva. |
| `backend/src/db/seed_bcn.ts` | 8 | Script CLI. |
| `backend/src/db/reset.ts` | 3 | Script CLI. |
| `backend/src/routes/merchants.ts` | 2 | Código de producción. |
| `backend/src/services/GeoDispatchService.ts` | 1 | Duplicado del `logger.info` siguiente. |
| `backend/src/observability/sentry.ts` | 1 | Bootstrap del propio Sentry. |
| `cruise-connect-main/src/hooks/useSocket.ts` | 5 | Logs de debug de eventos socket. |
| **Total** | **39** | |

## Codemod aplicado

### Backend

- `services/GeoDispatchService.ts:78` — eliminado (era duplicado del
  `logger.info(..., 'CASCADE Phase')` justo debajo).
- `routes/merchants.ts:51,130` — `import { logger } from '../utils/logger'`
  añadido y dos `console.log` reemplazados por `logger.info({ ... }, '[MERCHANT] ...')`.
- `observability/sentry.ts:57` — bootstrap de Sentry; `console.log` →
  `process.stderr.write(...)`. Razón: este código corre antes de que pino esté
  fully wired y queremos visibilidad por stderr aunque pino caiga. Pasa la
  regla `no-console` sin necesidad de eslint-disable.
- `db/seed_lp.ts`, `db/seed_bcn.ts`, `db/reset.ts` — `console.log` → `console.error`.
  Son CLI scripts; `console.error` va a stderr (convención Unix para
  status messages) y la regla `no-console` permite `error`. Mantenemos
  `console.error` en lugar de pino para no enfeitar la salida del CLI.

### Frontend

- `src/utils/logger.ts` (nuevo, 46 líneas) — helper con cuatro niveles:
  - `debug` y `info`: solo en `import.meta.env.DEV` (silencio en prod).
  - `warn`: siempre, vía `console.warn` (sigue permitido por la regla).
  - `error`: `Sentry.captureException(err, { extra })` siempre + `console.error`
    en dev. `try/catch` alrededor de Sentry para no romper tests sin DSN.
- `src/hooks/useSocket.ts` — `import { logger } from '@/utils/logger'`; cinco
  `console.log('Socket event: …', data)` → `logger.debug('Socket event: …', data)`.
- `src/observability/sentry.ts:19` — eliminado `eslint-disable-next-line
  no-console` que ahora era inútil (la regla permite `console.warn`).

### Reglas ESLint

- **Backend** (`backend/eslint.config.mjs`): `'no-console': ['error', { allow:
  ['warn', 'error'] }]` (subido de `warn` a `error` tras el codemod).
- **Frontend** (`cruise-connect-main/eslint.config.js`): `'no-console':
  ['warn', { allow: ['warn', 'error'] }]` (warn para no bloquear el CI con
  pre-existentes; `error` se aplicará en H-5.x).

## Verificación

```
$ grep -rn 'console\\.log\\s*(' backend/src --include='*.ts' | grep -v __tests__
(vacío)

$ grep -rn 'console\\.log\\s*(' cruise-connect-main/src --include='*.ts' --include='*.tsx' | grep -v __tests__
(vacío)

$ cd backend && npx eslint src
✖ 39 problems (0 errors, 39 warnings)   ← exit 0; sin warnings de no-console.

$ cd cruise-connect-main && npx eslint .
✖ 5 problems (0 errors, 5 warnings)     ← exit 0; sin warnings de no-console.

$ cd cruise-connect-main && npx vitest run
22 files, 127/127 tests passed.

$ cd cruise-connect-main && npm run build
0 warnings, build OK.
```

## Trazabilidad

- Auditoría: hallazgo `S-08`.
- Hoja de ruta: capítulo 2, hito H-2.2.
- Tag: `hito-H-2.2-completed`.
