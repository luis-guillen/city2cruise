# Hito H-7.3 — Game day DR (PITR Neon)

**Severidad:** INFO
**Owner:** Backend lead + observador
**Esfuerzo:** ~0.5 jornada (incluye write-up post-mortem)
**Estado:** ✅ Code-complete; **ejecución diferida al owner local** (no
hay Neon ni Fly aquí).

## Cambios

### `docs/runbooks/DR_RUNBOOK.md`

Nueva sección "Game Day (Hito H-7.3)" entre el bloque de drills y los
contactos de escalación. Documenta:

- Cadencia trimestral.
- Roles **operador** y **observador**.
- Escenario base: DROP SCHEMA + restore PITR contra staging.
- Anuncio previo de 24 h.
- Cierre con post-mortem blameless + PR de mejoras al runbook.

### `docs/devops/audits/post-h73/GAME_DAY_TEMPLATE.md` (nuevo)

Plantilla con cronómetro T0..T7 (DROP simulado → recovery), matriz de
métricas (**RTO < 4 h**, **RPO < 1 h**, filas perdidas, alertas que
dispararon), pre-flight, sección de pain points y formato de
post-mortem (línea de tiempo + qué fue bien + qué mejorar + acciones).

## Acción del owner

1. Programar el game day y anunciar en `#city2cruise-oncall` con 24 h de
   antelación.
2. Asignar operador y observador.
3. Copiar `GAME_DAY_TEMPLATE.md` a `GAME_DAY_<YYYY-Q>.md` y ejecutar.
4. Mergear PR con mejoras al runbook.
5. Programar el siguiente game day.

## Trazabilidad

- Hoja de ruta: capítulo 7, hito H-7.3.
- Tag: `hito-H-7.3-completed` (la primera ejecución firmada se commitea
  como `docs(dr): record YYYY-Qx game day evidence`).
