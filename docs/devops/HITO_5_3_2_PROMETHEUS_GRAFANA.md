# Hito 5.3.2 — Métricas Prometheus + dashboard Grafana

> Status: **Done** (2026-04-28)
> Fase: 5.3 — Observabilidad
> Predecesor: 5.3.1 (Sentry APM)
> Sucesor: 5.3.3 (KPIs de negocio)

## Objetivo

Exposición de métricas técnicas en formato Prometheus + dashboard
Grafana listo para importar. Cubre lo que Sentry no hace bien:
contadores, gauges, histograms con baja cardinalidad para alertas
basadas en tasas y umbrales.

## Entregables

| Artefacto | Ruta |
|---|---|
| Backend collector | `backend/src/observability/metrics.ts` |
| Wiring Express | `backend/src/server.ts` (httpMetricsMiddleware + GET /metrics) |
| Tests | `backend/src/__tests__/metrics.test.ts` (3 tests) |
| Dashboard JSON | `observability/grafana/city2cruise-dashboard.json` |
| Scrape config | `observability/prometheus.scrape.yml` |
| Dependencia | `prom-client@^15.1.3` |

## Métricas expuestas

### Default (Node.js)
Prefijo `city2cruise_`: process_cpu, resident_memory, eventloop_lag,
heap_size, gc_duration_seconds, etc.

### HTTP
| Métrica | Tipo | Labels |
|---|---|---|
| `city2cruise_http_requests_total` | Counter | method, route, status |
| `city2cruise_http_request_duration_seconds` | Histogram | method, route, status |

### WebSockets / DB
| Métrica | Tipo | Labels |
|---|---|---|
| `city2cruise_websocket_connections` | Gauge | namespace |
| `city2cruise_db_query_duration_seconds` | Histogram | op |

### Business (poblados en Hito 5.3.3)
| Métrica | Tipo | Labels |
|---|---|---|
| `city2cruise_requests_created_total` | Counter | locker_id |
| `city2cruise_requests_completed_total` | Counter | — |
| `city2cruise_requests_failed_total` | Counter | reason |
| `city2cruise_drivers_online` | Gauge | — |
| `city2cruise_request_match_seconds` | Histogram | — |

## Dashboard Grafana

10 paneles preconfigurados (variable `$env` para staging/production):

1. Request rate por status (timeseries)
2. Latency p50/p95/p99 (timeseries)
3. 5xx error rate % (stat con thresholds verde/amarillo/rojo)
4. Drivers online (stat)
5. WebSocket connections (stat)
6. Memory RSS MB (stat)
7. Requests creadas vs completadas vs falladas (1h acumulado)
8. Tiempo de match driver p50/p95
9. DB query duration p95 por operación
10. Event loop lag p99

Importable directamente en Grafana Cloud (free tier) o self-hosted.

## Endpoint

```
GET /metrics
Content-Type: text/plain; version=0.0.4; charset=utf-8
```

Sin auth en MVP — Fly.io expone la app por TLS pero no hay protección
adicional. Mejora futura: añadir basic auth con `METRICS_BASIC_AUTH_TOKEN`
o restringir por IP del Prometheus scraper.

## Verificación local

```bash
cd backend
npm run dev
curl http://localhost:9000/metrics | head -30
# Debe devolver métricas con prefijo city2cruise_
```

## Tests

```
PASS src/__tests__/metrics.test.ts
  Hito 5.3.2 — Prometheus /metrics
    ✓ expone metrics en formato Prometheus exposition
    ✓ cuenta peticiones HTTP por método/ruta/status
    ✓ counter business: requestsCreatedTotal expone label locker_id

Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
```

Añadidos a la lista de "tests sin DB" en `.github/workflows/ci.yml`.

## Cardinalidad

Vigilado: el label `route` se rellena con `req.route?.path` (template
de Express tipo `/api/requests/:id`), no con la URL real. Esto evita
explosión de cardinalidad por IDs.

Si una ruta supera 80 caracteres de path se marca como `too_long`
(safety net). Hoy ninguna ruta del backend excede ese límite.

## Próximo

Hito 5.3.3 — incrementar los counters business desde `RequestService`,
`DispatchService` y socket handlers con la lógica real.
