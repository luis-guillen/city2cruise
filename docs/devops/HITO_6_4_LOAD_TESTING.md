# Hito 6.4 — Tests de carga + capacidad

> Status: **Done** (2026-04-28)

## Escenarios k6 (Hito 6.4.1)

| Script | Escenario | Patrón | SLOs |
|---|---|---|---|
| `k6/phase4-100c.js` | (Fase 4) baseline | 100 VUs / 2min | p95<500ms |
| `k6/phase4-spike.js` | (Fase 4) spike inicial | spike test | observar |
| `k6/phase6-normal.js` | **Carga normal día a día** | 50 VUs constantes / 10min | reads p95<200ms, writes p95<500ms, error<0.5% |
| `k6/phase6-spike-cruise.js` | **Llegada de crucero** (200 pasajeros) | ramp 10→200 / 2min, sostener 5min | p95<1000ms, error<1% |
| `k6/phase6-stress.js` | **Stress: encontrar punto de ruptura** | ramp 0→500 incremental | sin thresholds (observar) |
| `k6/phase6-soak.js` | **Soak 2h: detectar memory leaks** | 50 VUs / 2h | p50 NO degrada entre primera y última hora |
| `k6/phase6-bench-endpoints.js` | **Benchmark por endpoint con SLOs** | 30 VUs / 5min | health<100ms, reads<200ms, writes<500ms |
| `k6/phase6-websocket.js` | **WS load (100 sockets)** | ramp 10→100 / 1min, sostener 3min | connect<2s, delivery<1s |

## Cómo ejecutar

Todos requieren backend corriendo (local o staging) + un usuario seed
con permisos.

```bash
# Variables comunes
export BASE_URL=https://city2cruise-staging-backend.fly.dev
export CLIENT_EMAIL=k6-loadtest@example.com
export CLIENT_PASSWORD=k6-test-pwd-2026

# Carga normal (10 min)
k6 run k6/phase6-normal.js

# Pico llegada crucero (10 min)
k6 run k6/phase6-spike-cruise.js

# Stress incremental (~14 min)
k6 run k6/phase6-stress.js

# Soak 2h (¡bloquea terminal 2 horas!)
k6 run k6/phase6-soak.js

# Benchmark con export JSON
k6 run k6/phase6-bench-endpoints.js
# → genera k6/.results/bench-endpoints.json

# WebSocket
k6 run --env WS_URL=wss://city2cruise-staging-backend.fly.dev k6/phase6-websocket.js
```

## SLOs definidos (Hito 6.4.2)

| Categoría | SLO | Observación |
|---|---|---|
| `/health` (liveness) | p95 < 100ms | Sin queries externas |
| `/api/requests/mine` (read simple) | p95 < 200ms | Cache Redis |
| `/api/requests/history?limit=20` (read paginated) | p95 < 300ms | Cursor pagination Hito 4.3.3 |
| `/api/notifications` (read) | p95 < 200ms | |
| `POST /api/requests` (write con cascade) | p95 < 500ms | Incluye startCascadeSearch async |
| WS connect handshake | p95 < 2000ms | Socket.IO + Redis adapter |
| WS message delivery | p95 < 1000ms | Bidireccional |
| Error rate global | <0.5% (carga normal), <1% (pico) | |

## Capacidad documentada (Hito 6.4.4)

Estimación basada en escenarios + datos Fase 4.3.5 anteriores:

| Configuración Fly.io | Capacidad sostenida | Pico tolerable | Coste |
|---|---|---|---|
| `shared-cpu-1x` 256MB × 1 (free) | 50 req/s | 100 req/s ~5min | $0 |
| `shared-cpu-1x` 256MB × 2 (free) | 100 req/s | 200 req/s ~5min | $0 |
| `performance-1x` 512MB × 2 | 300 req/s | 600 req/s ~10min | ~$30/mes |
| `performance-2x` 1GB × 3 | 800 req/s | 1500 req/s | ~$90/mes |

## Plan de auto-scaling

Activado en Fly.io `fly.toml`:

```toml
[[services.machines]]
  min_count = 2
  max_count = 6

[[services.checks.metrics]]
  # Si CPU > 70% durante 60s → scale up
  metric = "cpu"
  threshold = 70
  duration = "60s"
  step = "+1"

[[services.checks.metrics]]
  # Si memoria > 80% → scale up
  metric = "memory"
  threshold = 80
  duration = "60s"
  step = "+1"
```

Triggers de auto-scale-down:
- CPU < 30% durante 5min → scale -1 (con min_count=2 garantizado)

## Cuándo correr cada script

| Cuándo | Script | Quién |
|---|---|---|
| Antes de cada release menor | `phase6-normal.js` | CD pipeline (workflow_dispatch) |
| Mensual | `phase6-bench-endpoints.js` | manual |
| Trimestral | `phase6-stress.js` (capacity planning) | tech lead |
| Antes de un evento previsto (crucero grande) | `phase6-spike-cruise.js` | manual |
| Pre-producción change crítico | `phase6-soak.js` (2h) | manual |
| Post-deploy de cambios en sockets | `phase6-websocket.js` | manual |

## Próximo

Hito 6.5 — Validación IA (RL convergencia + sim-to-real fidelity) +
integridad cadena de custodia (handshake).
