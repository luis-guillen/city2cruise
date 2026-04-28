# Hito 5.3.3 — Métricas de negocio (KPIs)

> Status: **Done** (2026-04-28)
> Fase: 5.3 — Observabilidad
> Predecesor: 5.3.2 (Prometheus + Grafana)
> Sucesor: 5.3.4 (Alerting)

## Objetivo

Conectar el infrastructure de métricas Prometheus (Hito 5.3.2) con la
lógica real del producto. Dejar de mirar sólo CPU/memoria y empezar a
mirar **lo que importa al negocio**.

## KPIs implementados

| KPI | Métrica Prometheus | Origen | Significado |
|---|---|---|---|
| Solicitudes creadas | `city2cruise_requests_created_total{locker_id}` | `RequestService.createRequest` | Volumen de demanda por locker |
| Solicitudes completadas | `city2cruise_requests_completed_total` | `RequestService.depositRequest` | Conversiones exitosas |
| Solicitudes falladas | `city2cruise_requests_failed_total{reason}` | reservado, listo | Para tasa de fallo cuando se añadan cancelaciones explícitas |
| Tiempo de match | `city2cruise_request_match_seconds` | `acceptRequest` calcula `now - created_at` | Cuánto tarda un driver en aceptar tras crearse el request |
| Drivers online | `city2cruise_drivers_online` | `sockets/io.ts` connect/disconnect | Capacidad de oferta en tiempo real |
| WebSocket conns activas | `city2cruise_websocket_connections{namespace}` | idem | Salud del bus de eventos |

## Derivados útiles en Grafana

```promql
# Tasa de éxito (último 1h)
sum(rate(city2cruise_requests_completed_total[1h]))
  / sum(rate(city2cruise_requests_created_total[1h]))

# Tiempo medio de match
rate(city2cruise_request_match_seconds_sum[15m])
  / rate(city2cruise_request_match_seconds_count[15m])

# p95 de tiempo de match
histogram_quantile(0.95,
  sum by (le) (rate(city2cruise_request_match_seconds_bucket[15m])))

# Drivers online vs requests pendientes (cuando exista métrica pending)
city2cruise_drivers_online vs sum(city2cruise_requests_pending)
```

El dashboard `observability/grafana/city2cruise-dashboard.json` ya
incluye los paneles 4 (drivers online), 7 (creadas/completadas/falladas
acumulado 1h) y 8 (match time p50/p95) que usan estos contadores.

## Decisiones de diseño

1. **`requestsFailedTotal` con label `reason`** pero sin `.inc()` aún.
   El código de cancelación explícita por timeout / no_driver / cancel
   no existe todavía en `RequestService`. La métrica está lista para
   cuando se añadan esos paths, sin necesidad de tocar TS extra.
2. **Match time clampeado a 24h.** Si por algún bug `created_at` es
   inválido (ej. NaN o futuro), no contaminamos el histograma.
3. **`driversOnline` desde `activeDrivers.size`** post-mutación — la
   gauge es siempre consistente con el estado interno.
4. **WS connections con label `namespace`** aunque hoy sólo usemos
   `default`, para soportar futuros namespaces (`/admin`, `/dispatch`).

## Verificación

Tests existentes siguen verdes (17/17 sin DB). El test de smoke
`metrics.test.ts` ya verifica:
- formato exposition de Prometheus
- contador HTTP por método/ruta/status
- counter business expone label `locker_id` correctamente

Para observar los counters business hay que ejecutar el flujo end-to-end
(crear request → aceptar → depositar). Test E2E completo pendiente para
QA final (Hito 37).

## Coste de cardinalidad

| Métrica | Combinaciones máx. | Riesgo |
|---|---|---|
| `requests_created_total{locker_id}` | ~50 lockers | bajo |
| `requests_failed_total{reason}` | ~5 reasons | bajo |
| `websocket_connections{namespace}` | 1-3 namespaces | bajo |
| Resto (sin labels o con labels acotados) | <1k series | bajo |

Total estimado: **<200 series** en producción. Free tier Grafana Cloud
permite 10k series → 50× margen.

## Próximo

Hito 5.3.4 — Alerting basado en estos KPIs:
- 5xx rate >1% (ya en dashboard)
- p95 latencia >500ms
- match time p95 >120s
- drivers_online == 0 durante >5 min (mercado caído)
