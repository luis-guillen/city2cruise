# Hito H-2.1 — Reforzar política CORS y alertar rechazos (S-06)

**Severidad:** MEDIO
**Owner:** Backend
**Esfuerzo:** ~2 horas
**Estado:** ✅ Cerrado

## Cambio

Se sustituye el `startsWith` permisivo por una whitelist explícita
parametrizada por entorno y se añade observabilidad de rechazos en Sentry.

`backend/src/config/env.ts`:

- Nuevo campo `allowedOrigins`: array poblado desde `ALLOWED_ORIGINS`
  (coma-separada). Por defecto `9100/9101/9102/9103`.

`backend/src/server.ts`:

- Bloque CORS reescrito:
  - `Set` con `config.frontendUrl` + `config.allowedOrigins`.
  - En `NODE_ENV !== 'production'`, regex extra para `http://localhost:<4-5
    digits>` y `http://192.168.x.y[:port]`.
  - En cualquier otro caso, `Sentry.captureMessage('CORS rechazo', {extra:
    {origin}})` y `callback(new Error('Not allowed by CORS'))`.
  - `try/catch` alrededor del Sentry call para no romper tests cuando Sentry
    no está inicializado.

`backend/src/sockets/io.ts`:

- Idéntica lógica para Socket.IO, mensaje `CORS rechazo (socket)`.

## Test

`backend/src/__tests__/cors.test.ts` (5 specs, sin DB):

1. Origen foráneo (`https://attacker.example`) → `Access-Control-Allow-Origin`
   ausente.
2. `config.frontendUrl` en whitelist → header propagado.
3. Origen de `ALLOWED_ORIGINS` (`http://localhost:9101`) → header propagado.
4. En `development`, `http://localhost:5173` y `http://192.168.1.10:9100`
   permitidos por regex.
5. En `production`, los mismos dos orígenes son rechazados (regex sólo en dev).

## Evidencia

```
$ npx jest src/__tests__/cors.test.ts --silent --no-coverage
PASS src/__tests__/cors.test.ts (8.52 s)
Tests: 5 passed, 5 total

$ npx jest src/__tests__/env.test.ts src/__tests__/cors.test.ts --silent --no-coverage
PASS src/__tests__/cors.test.ts (5.22 s)
PASS src/__tests__/env.test.ts (8.50 s)
Tests: 10 passed, 10 total

$ npx tsc --noEmit
(sin errores)
```

## Trazabilidad

- Auditoría: hallazgo `S-06`.
- Hoja de ruta: capítulo 2, hito H-2.1.
- Tag: `hito-H-2.1-completed`.
