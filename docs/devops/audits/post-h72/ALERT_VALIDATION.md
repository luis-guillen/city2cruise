# H-7.2 — Validación de alertas Prometheus + Sentry

**Fecha de ejecución:** _YYYY-MM-DD_
**Operador:** _alias_
**Entorno:** staging (`city2cruise-staging.fly.dev`)
**Origen de las reglas:** `observability/alert-rules.yml`
**Canal de alertas:** `#city2cruise-oncall` en Slack + Sentry email.

## Matriz de alertas (10 reglas)

Para cada alerta inducimos la condición y verificamos:

1. La regla **se dispara** (Alertmanager / Grafana muestra `FIRING`).
2. Llega notificación al canal correspondiente.
3. La severidad (`page` vs `warning`) y el `summary`/`description` son
   correctos.
4. Se respeta `for: ...` (no falsos positivos antes del periodo).

| # | Alerta (grupo) | Inducir | Esperado | Resultado |
| ---: | --- | --- | --- | --- |
| 1 | `HighErrorRate` (slo, severity=page, for=5m) | Lanzar k6 que pegue a un endpoint que devuelva 500 forzados, ≥1 % de las peticiones durante 5 min. | Notificación en Slack `severity: page`, summary "5xx error rate > 1 %". | ✅ / ❌ |
| 2 | `HighLatencyP95` (slo, severity=warning, for=10m) | k6 con `--vus 30 --duration 12m` apuntando a `/api/admin/metrics` con DB cargada (provoca p95>500 ms). | Notificación `severity: warning`, summary "p95 > 500 ms". | ✅ / ❌ |
| 3 | `VeryHighLatencyP95` (slo, severity=page, for=5m) | Stop temporal de Redis para que el rate-limiter haga fallback síncrono y la p95 supere 2 s durante 5 min. | Notificación `severity: page`. | ✅ / ❌ |
| 4 | `BackendDown` (slo, severity=page, for=2m) | `flyctl scale count 0 --app city2cruise-staging-backend`, esperar 3 min. | Notificación `severity: page`. **Volver a escalar inmediatamente tras la confirmación.** | ✅ / ❌ |
| 5 | `NoDriversOnline` (business, severity=page, for=5m) | Cerrar todas las sesiones driver de staging y esperar 6 min. | Notificación `severity: page`. | ✅ / ❌ |
| 6 | `SlowMatchTime` (business) | Ralentizar dispatch (poner `RL_SERVICE_TIMEOUT_MS=10000` y matar `rl_service`). | Notificación según severidad declarada. | ✅ / ❌ |
| 7 | `RequestCompletionRateLow` (business) | k6 que cree 50 requests pero NO marque ninguno como completado. | Notificación con summary correcto. | ✅ / ❌ |
| 8 | `HighMemoryUsage` (slo) | `node --max-old-space-size=64` o cargar k6 spike con DB enorme; observar RSS > 90 % de 512 MB. | Notificación. | ✅ / ❌ |
| 9 | `EventLoopLagP99High` (slo) | Insertar `await new Promise(r => setTimeout(r, 1000))` en un endpoint usado por k6 (sólo en staging, branch `chore/induce-lag`). | Notificación. | ✅ / ❌ |
| 10 | `BackupFailedToday` (ops) | Pausar el cron job de backup durante un día y esperar al check post-medianoche UTC. | Notificación a la mañana siguiente. | ✅ / ❌ |

## Sentry

- Generar excepción no manejada en staging desde un endpoint nuevo
  (branch `chore/induce-sentry`):
  ```ts
  router.get('/__induce-error', () => { throw new Error('H-7.2 induce'); });
  ```
- Verificar:
  - Issue creado en Sentry con `release` correcto.
  - `extra.environment === 'staging'`.
  - El alert handler de Slack recibe el evento.
  - Volver a borrar la ruta `/__induce-error` antes de cerrar el hito.

## Recovery

Tras inducir cada condición, **revertir inmediatamente**:

- Restaurar Redis.
- `flyctl scale count 2`.
- Borrar branches `chore/induce-*`.
- Reabrir sesiones driver / restaurar `RL_SERVICE_TIMEOUT_MS`.

## Anomalías observadas

_Reglas que NO dispararon, falsos positivos, latencias anómalas en la
notificación, etc._

## Decisión

- [ ] **PASS**: 10/10 alertas validadas.
- [ ] **FAIL**: _N_ alertas requieren ajuste. Acciones: _…_

Firma: _alias_, _fecha_.
