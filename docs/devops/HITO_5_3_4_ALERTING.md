# Hito 5.3.4 — Alerting (Slack + PagerDuty + email)

> Status: **Done** (2026-04-28)
> Fase: 5.3 — Observabilidad
> Predecesor: 5.3.3 (KPIs business)
> Sucesor: 5.3.5 (logging centralizado)

## Objetivo

Cuando una métrica cruza un umbral, alguien se entera **inmediatamente**
por el canal correcto, con runbook al alcance, sin spam.

## Diseño de canales

| Severidad | Canal primario | Canal secundario | Quién recibe | Acción esperada |
|---|---|---|---|---|
| **page** | PagerDuty (con escalación) | Slack `#city2cruise-oncall` + email `oncall@city2cruise.com` | on-call rotativo | < 15 min: ack y abrir runbook |
| **warning** (backend) | Slack `#backend` | — | equipo backend | < 1 día laboral: investigar |
| **warning** (ops) | Slack `#ops` | — | equipo ops | < 1 día laboral: investigar |
| **info / resolved** | Slack `#city2cruise-alerts` | — | todos | acuse de recibo opcional |

## Reglas de alertas implementadas

### SLOs técnicos (`city2cruise-slo`)

| Alert | Umbral | Severidad | For |
|---|---|---|---|
| `HighErrorRate` | 5xx rate > 1% | page | 5m |
| `HighLatencyP95` | p95 > 500ms | warning | 10m |
| `VeryHighLatencyP95` | p95 > 2s | page | 5m |
| `BackendDown` | up==0 | page | 2m |

### KPIs de negocio (`city2cruise-business`)

| Alert | Umbral | Severidad | For |
|---|---|---|---|
| `NoDriversOnline` | drivers_online == 0 | page | 5m |
| `SlowMatchTime` | match p95 > 120s | warning | 15m |
| `RequestCompletionRateLow` | completed/created < 70% | warning | 30m |

### Runtime (`city2cruise-runtime`)

| Alert | Umbral | Severidad | For |
|---|---|---|---|
| `HighMemoryUsage` | RSS > 200MB (de 256 disponibles en Fly) | warning | 10m |
| `EventLoopLagP99High` | event loop p99 > 100ms | warning | 10m |

### CI/CD (`city2cruise-ci`)

| Alert | Umbral | Severidad |
|---|---|---|
| `BackupFailedToday` | sin éxito en 24h | page |

## Archivos

| Ruta | Contenido |
|---|---|
| `observability/alert-rules.yml` | Reglas Prometheus (importables) |
| `observability/alertmanager.yml` | Routing → Slack/PagerDuty/email + inhibit_rules |

## Inhibición de cascadas

Cuando `BackendDown` está activa, suprime el resto de alertas backend
del mismo `environment` (no tiene sentido recibir 7 alertas distintas
si la app entera está caída).

## Variables de entorno necesarias

Para el Alertmanager (self-hosted o como secrets en Grafana Cloud):

| Variable | Para qué |
|---|---|
| `SLACK_WEBHOOK_URL` | canal `#city2cruise-alerts` |
| `SLACK_WEBHOOK_URL_BACKEND` | canal `#backend` |
| `SLACK_WEBHOOK_URL_OPS` | canal `#ops` |
| `SLACK_WEBHOOK_URL_ONCALL` | canal `#city2cruise-oncall` |
| `PAGERDUTY_INTEGRATION_KEY` | servicio PD city2cruise-prod |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD` | envío de emails |

## Volumen estimado

Con los umbrales actuales y bajo carga normal:
- 0-2 warnings/semana esperados (false positives ya filtrados con `for: 10m`)
- 0 pages al mes esperados en operación estable
- 1 page mensual aceptable (el SLO permite 99.5% uptime)

Si superamos 3 pages/mes durante 2 meses seguidos → revisar umbrales o
arreglar root cause estructural.

## Verificación

1. Dispatcher Prometheus carga `alert-rules.yml`:
   ```bash
   promtool check rules observability/alert-rules.yml
   ```
   (no incluido en este sandbox; ejecutar local cuando Prometheus esté
   levantado).

2. Alertmanager valida `alertmanager.yml`:
   ```bash
   amtool check-config observability/alertmanager.yml
   ```

3. Test fire manual (cuando esté en prod):
   ```bash
   curl -X POST <pushgateway>/metrics/job/test \
     --data-binary @- <<EOF
   city2cruise_http_requests_total{status="500",environment="staging"} 100
   EOF
   ```

## Próximo

Hito 5.3.5 — Logging centralizado (Better Stack o Grafana Cloud Logs).
Sin logs centralizados, los runbooks de las alertas pierden la mitad
de su utilidad (no hay forma de buscar "qué pasó en ese minuto").
