# Hito H-1.1 — VAPID fail-fast (S-01)

**Severidad:** ALTO
**Owner:** Backend lead
**Esfuerzo:** ~1 hora
**Estado:** ✅ Cerrado

## Cambio

`backend/src/config/env.ts`: bloque `vapid` reescrito al patrón fail-fast IIFE
(equivalente al usado en `JWT_SECRET`, `STRIPE_SECRET_KEY`, etc.):

- En `NODE_ENV=production` y sin `VAPID_PUBLIC_KEY` o `VAPID_PRIVATE_KEY`, el
  módulo lanza `Error('FATAL: VAPID_*_KEY es obligatorio en producción …')`.
- En `development`/`test`, la ausencia es tolerable y la clave devuelve `''`.
- Los antiguos fallbacks hardcodeados (`BGscsMyO1ynE…` y `0XNrTZGcDO…`)
  se eliminan del código de producción.

## Ficheros tocados

- `backend/src/config/env.ts` — refactor del bloque `vapid`.
- `scripts/generate-vapid.sh` (nuevo, +x) — wrapper de `npx web-push
  generate-vapid-keys` con salidas `--json`/`--env`/`pretty`.
- `backend/src/__tests__/env.test.ts` (nuevo) — 5 specs cubriendo prod-throw,
  dev-tolerable, happy-path y regresión de fallbacks hardcodeados.

## Evidencia de verificación

```
$ grep -rn 'BGscsMyO1ynE\|0XNrTZGcDO' backend/src/
(vacío) — PASS

$ npx jest src/__tests__/env.test.ts --silent --no-coverage
PASS src/__tests__/env.test.ts (7.24 s)
  ✓ arroja FATAL en producción si falta VAPID_PRIVATE_KEY
  ✓ arroja FATAL en producción si falta VAPID_PUBLIC_KEY
  ✓ en development, claves VAPID vacías son tolerables (no throw)
  ✓ en producción, con ambas claves definidas, carga correctamente
  ✓ no quedan claves VAPID hardcodeadas en el módulo
Tests: 5 passed, 5 total

$ npx tsc --noEmit
(sin errores)
```

## Acciones de rotación operativas (responsabilidad del owner)

1. Generar par nuevo en local:

   ```bash
   ./scripts/generate-vapid.sh
   ```

2. Rotar el secreto en Fly:

   ```bash
   fly secrets set \
     VAPID_PUBLIC_KEY=... \
     VAPID_PRIVATE_KEY=... \
     --app city2cruise-backend
   ```

3. Comunicar en release notes que el SW del frontend re-suscribirá a los
   usuarios automáticamente al cambiar la clave pública (los antiguos
   `pushManager.subscribe` quedan invalidados al rotar).

## Trazabilidad

- Auditoría: hallazgo `S-01`.
- Hoja de ruta: capítulo 1, hito H-1.1.
- Tag de evidencia post-cierre: `hito-H-1.1-completed`.
