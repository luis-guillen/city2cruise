# Hito H-7.2 — Validar alertas Prometheus + Sentry

**Severidad:** INFO
**Owner:** Backend / DevOps
**Esfuerzo:** ~2 horas
**Estado:** ✅ Code-complete; **ejecución diferida al owner local** (no
hay Prometheus/Alertmanager/Sentry en el sandbox).

## Inventario

`observability/alert-rules.yml` define **10 reglas** en 2 grupos:

| Grupo | Regla | Severidad | `for:` |
| --- | --- | --- | --- |
| `city2cruise-slo` | `HighErrorRate` | page | 5m |
| `city2cruise-slo` | `HighLatencyP95` | warning | 10m |
| `city2cruise-slo` | `VeryHighLatencyP95` | page | 5m |
| `city2cruise-slo` | `BackendDown` | page | 2m |
| `city2cruise-slo` | `HighMemoryUsage` | warning | — |
| `city2cruise-slo` | `EventLoopLagP99High` | warning | — |
| `city2cruise-business` | `NoDriversOnline` | page | 5m |
| `city2cruise-business` | `SlowMatchTime` | warning | — |
| `city2cruise-business` | `RequestCompletionRateLow` | warning | — |
| `city2cruise-ops` | `BackupFailedToday` | page | — |

## Plantilla de evidencia

[`docs/devops/audits/post-h72/ALERT_VALIDATION.md`](audits/post-h72/ALERT_VALIDATION.md)
incluye, para cada regla, **cómo inducir la condición** (ej: lanzar k6
contra endpoint que devuelve 500 forzados, parar Redis, escalar a 0
machines, etc.) y la matriz de verificación.

## Sentry

Branch temporal `chore/induce-sentry` añade un endpoint
`/__induce-error` que lanza una excepción no manejada. Se valida que:

1. Sentry crea issue con `release` correcto.
2. `extra.environment === 'staging'`.
3. El alert handler de Slack recibe el evento.

Borrar la ruta tras la prueba.

## Recovery

La plantilla incluye sección "Recovery" para revertir cada inducción
(restaurar Redis, re-escalar Fly, borrar branches `chore/induce-*`,
restaurar `RL_SERVICE_TIMEOUT_MS`).

## Trazabilidad

- Hoja de ruta: capítulo 7, hito H-7.2.
- Tag: `hito-H-7.2-completed` (evidencia firmada en commit follow-up).
