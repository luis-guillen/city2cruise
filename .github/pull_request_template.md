## ¿Qué hace este PR?

<!-- Una linea, en imperativo: "Añade rate limiter por usuario en /api/auth" -->

## Issue / Hito relacionado

Closes #
Hito:

## Tipo de cambio

- [ ] feat (nueva funcionalidad)
- [ ] fix (bug fix)
- [ ] perf (mejora de rendimiento)
- [ ] refactor (sin cambio funcional)
- [ ] docs
- [ ] test
- [ ] ci / chore

## Checklist

- [ ] El branch parte de `main` y está al día (`git pull --rebase origin main`)
- [ ] `npm test` pasa en frontend y backend (o se justifica el fail)
- [ ] `npm run lint` y `npx tsc --noEmit` sin errores nuevos
- [ ] Cambios en SQL incluyen migración idempotente (`IF NOT EXISTS`)
- [ ] Si toca a11y: `npm run test:a11y` y Lighthouse score ≥ 90 verificado
- [ ] Si toca rendimiento: medición antes/después incluida en la descripción
- [ ] Si añade dependencias: `npm audit --omit=dev` clean (high+)
- [ ] Documentación actualizada (`docs/`, `README`, comentarios) si aplica

## ¿Cómo lo has probado?

<!-- Pasos exactos para reproducir / verificar. Capturas si afecta UI. -->

## Riesgos / consideraciones

<!-- ¿Migración destructiva? ¿Rollback plan? ¿Feature flag? -->
