# Índice de hitos de remediación

Tablero de seguimiento de los 38 hitos definidos en
`HOJA_DE_RUTA_REMEDIACION_2026-04-29.pdf`.

Estado: `[ ]` pendiente · `[~]` en curso · `[x]` cerrado · `[!]` bloqueado.

## Capítulo 0 — Preparación

- [x] H-0.1 — Crear rama integradora `FINAL` desde `phase2-4`
- [x] H-0.2 — Verificar convenciones (commitlint, semantic-release, PR template, CI)
- [x] H-0.3 — Snapshot pre-remediación (`npm audit` backend + frontend)
- [x] H-0.4 — Crear índice de hitos y `HITO_REMEDIACION_00_BASE.md`
- [ ] H-0.5 — Tag `pre-remediation-2026-04-29` y push a `origin`
- [~] H-0.6 — `docker build` + `docker scout cves` (GAP — owner ejecuta local)

## Capítulo 1 — Bloque inmediato (pre-producción) — HALLAZGOS ALTOS

- [x] H-1.1 — Eliminar fallbacks hardcodeados de VAPID (S-01)
- [x] H-1.2 — Cerrar vulnerabilidades altas en frontend: axios, lodash (S-02)
- [x] H-1.3 — Contenedores no-root + HEALTHCHECK por imagen (S-03)
- [x] H-1.4 — Cabeceras de seguridad en Nginx frontend (S-04)
- [x] H-1.5 — Limpiar IP local hardcodeada en logs de arranque (S-07)

## Capítulo 2 — Hardening (post-launch)

- [x] H-2.1 — CORS hardening + Sentry alert (S-06)
- [x] H-2.2 — Migrar console.log al logger estructurado (S-08)
- [x] H-2.3 — Limpieza de archivos residuales (S-09)
- [x] H-2.4 — ESLint backend con no-floating-promises (I-01)
- [ ] H-2.5
- [ ] H-2.6
- [ ] H-2.7

## Capítulo 3 — Observabilidad y auditoría continua

- [x] H-3.1 — Activar strict modo transición (S-10 1/4)
- [x] H-3.2 — Activar strictNullChecks (S-10 2/4)
- [x] H-3.3 — Erradicar any + noImplicitAny (S-10 3/4)
- [x] H-3.4 — Compartir tipos backend ↔ frontend (S-10 4/4)
- [ ] H-3.5

## Capítulo 4 — Resiliencia y SLO

- [ ] H-4.1
- [ ] H-4.2
- [ ] H-4.3
- [ ] H-4.4

## Capítulo 5 — Calidad de código y deuda técnica

- [ ] H-5.1
- [ ] H-5.2
- [ ] H-5.3
- [ ] H-5.4
- [ ] H-5.5

## Capítulo 6 — Cumplimiento (RGPD, Stripe, accesibilidad)

- [ ] H-6.1
- [ ] H-6.2
- [ ] H-6.3
- [ ] H-6.4

## Capítulo 7 — Continuidad (DR, backups)

- [ ] H-7.1
- [ ] H-7.2
- [ ] H-7.3

## Capítulo 8 — Re-auditoría a 30 días

- [ ] H-8.1 — Re-ejecutar `npm audit` y comparar con baseline
- [ ] H-8.2 — Re-ejecutar `docker scout cves` y comparar
- [ ] H-8.3 — Re-ejecutar workflow `zap-baseline.yml`
- [ ] H-8.4 — Firmar y archivar el informe `post-remediation`

---

> Los enunciados detallados de cada hito (ficheros, pasos, criterios) viven en
> `HOJA_DE_RUTA_REMEDIACION_2026-04-29.pdf`. A medida que se cierre cada hito
> se generará un commit con conventional message y, opcionalmente, una nota
> en `HITO_REMEDIACION_H-X.Y.md` con evidencias y comandos ejecutados.
