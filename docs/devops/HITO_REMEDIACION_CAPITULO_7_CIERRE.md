# Cierre del Capítulo 7 — Validación de carga y observabilidad

**Fecha de cierre:** 2026-04-29
**Rama:** `FINAL` (commit `df04c3d`)
**Hitos cubiertos:** H-7.1, H-7.2, H-7.3 — todos cerrados como
**code-complete**.

## Resumen

| Hito | Severidad | Hallazgo | Estado | Tag |
| --- | --- | --- | --- | --- |
| H-7.1 | INFO | I-04 — sin reporte k6 firmado contra staging | ✅ code-complete | `hito-H-7.1-completed` |
| H-7.2 | INFO | sin validación reciente de alertas | ✅ code-complete | `hito-H-7.2-completed` |
| H-7.3 | INFO | sin game day DR ensayado | ✅ code-complete | `hito-H-7.3-completed` |

## Por qué "code-complete" y no "executed"

Los tres hitos requieren **infraestructura real** (staging desplegado,
Prometheus+Alertmanager, Sentry, Neon project con PITR). El sandbox de
trabajo no las tiene, así que se aplican los siguientes principios:

- **Lo que SÍ se hace en este hito**: artefactos reproducibles
  versionados — runbooks, plantillas de evidencia con todos los
  comandos, criterios PASS/FAIL, recovery procedures, post-mortem
  format, sección Game Day en el DR runbook.
- **Lo que se difiere al owner**: la ejecución y la captura de los
  outputs reales (k6 summaries, Grafana screenshots, Sentry issues,
  cronómetro RTO/RPO) que se commitean luego como
  `docs(audit): add H-7.x evidence`.

Este patrón ya se usó en H-1.3 (docker run + scout) y H-1.4
(securityheaders.com) — la infraestructura local del owner es la única
que puede generar la firma.

## Plantillas listas para usar

| Plantilla | Para |
| --- | --- |
| `docs/devops/audits/post-h71/RESULTS_TEMPLATE.md` | k6 100c + spike, SLOs, métricas Fly. |
| `docs/devops/audits/post-h72/ALERT_VALIDATION.md` | 10 alert rules, cómo inducir cada una, recovery. |
| `docs/devops/audits/post-h73/GAME_DAY_TEMPLATE.md` | DR cronómetro T0..T7, RTO/RPO, post-mortem blameless. |

## Próximos capítulos

Capítulo 8 — Plan de mejora 30/60/90 días post-remediación.

Si el roadmap no continúa más allá de Cap. 7, el cierre del programa
se firma con la re-auditoría a 30 días definida en
`HITO_REMEDIACION_00_BASE.md` § 3.
