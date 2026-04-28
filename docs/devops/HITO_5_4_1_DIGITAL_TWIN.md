# Hito 5.4.1 — Despliegue del Gemelo Digital (stub funcional)

> Status: **Done** (2026-04-28)
> Fase: 5.4 — Digital Twin
> Sucesor: 5.4.2 (sim-to-real con `rl_service`)

## Qué se entrega

Un microservicio Python independiente (`digital_twin/`) que expone una
réplica virtual del estado de City2Cruise. Funcional como stub:
mantiene lockers, drivers y requests en memoria, acepta eventos de
sincronización del backend y permite ejecutar simulaciones sintéticas.

## Arquitectura

```
┌──────────────┐   sync events   ┌─────────────────┐
│ backend Node │ ──────────────▶ │ digital_twin    │
│ (Fly.io)     │   POST /sync    │ (FastAPI Py3.11)│
└──────────────┘                 │  estado RAM     │
       │                         │  + simulación   │
       │ GET /api/internal/...   └────────┬────────┘
       ▼                                  │ GET /state, /scenario/run
┌──────────────┐                          │
│ rl_service   │ ◀────── future 5.4.2 ────┘
└──────────────┘
```

## Estructura

```
digital_twin/
├── README.md
├── requirements.txt        ← FastAPI 0.115, Pydantic 2.9, httpx
├── Dockerfile              ← python:3.11-slim, healthcheck /health
├── fly.toml                ← app city2cruise-twin, mad, auto_stop
├── .dockerignore
├── __init__.py             ← __version__
├── schemas.py              ← Pydantic: LockerState, DriverState,
│                             RequestState, SyncEvent, ScenarioRequest,
│                             TwinSnapshot, Aggregates
├── state.py                ← TwinStore singleton con asyncio.Lock,
│                             dispatch de 7 tipos de eventos, seed
│                             estático de 5 lockers + 3 drivers
├── main.py                 ← FastAPI app: /health, /state, /state/*,
│                             /sync, /scenario/run
└── tests/
    └── test_state.py       ← 5/5 tests PASS
```

## Endpoints

| Método | Path | Función |
|---|---|---|
| GET | `/health` | Liveness — devuelve version, env, timestamp |
| GET | `/state` | Snapshot completo del gemelo (Pydantic-validated) |
| GET | `/state/lockers` | Estado de los lockers + count |
| GET | `/state/drivers` | Estado de drivers + count |
| GET | `/state/aggregates` | Sólo métricas derivadas (para Grafana) |
| POST | `/sync` | Backend empuja un SyncEvent (acepta 202) |
| POST | `/scenario/run` | Ejecuta una simulación poisson y devuelve métricas |

## Tipos de SyncEvent soportados

`locker.status_changed`, `driver.position_changed`,
`driver.status_changed`, `request.created`, `request.assigned`,
`request.deposited`, `request.completed`, `request.cancelled`.

Cada evento tiene un `payload` con los campos necesarios. El dispatcher
en `state.py::TwinStore._dispatch` los maneja con asyncio.Lock para
serializar mutaciones.

## Match time tracking

Cuando llega `request.assigned`, se calcula `timestamp - created_at`
del request original y se añade a `recent_match_seconds` (rolling 100
muestras). El aggregate `avg_match_seconds_15m` lo expone para Grafana.

## Tests

```
collected 5 items
digital_twin/tests/test_state.py::test_seed_initial_state PASSED
digital_twin/tests/test_state.py::test_locker_status_changed PASSED
digital_twin/tests/test_state.py::test_driver_position_and_status PASSED
digital_twin/tests/test_state.py::test_request_lifecycle_and_match_time PASSED
digital_twin/tests/test_state.py::test_unknown_locker_id_is_ignored PASSED
============================== 5 passed ==============================
```

Nuevo job CI `digital-twin` añadido a `.github/workflows/ci.yml`.

## Despliegue

```bash
cd digital_twin
flyctl launch --copy-config --name city2cruise-twin --no-deploy
flyctl secrets set --app city2cruise-twin TWIN_ENV=production
flyctl deploy
flyctl status --app city2cruise-twin
curl https://city2cruise-twin.fly.dev/health
```

Free tier: `auto_stop_machines = true` + `min_machines_running = 0`
para que no consuma horas Fly cuando no hay tráfico.

## Decisiones técnicas

1. **Estado en RAM** — Suficiente para MVP y simulación. Persistencia
   queda como mejora futura (5.4.3 puede añadir snapshot a Postgres si
   se necesita histórico).
2. **Microservicio separado** del backend Node.js — Aislamiento de
   carga (la simulación puede ser pesada), lenguaje correcto (Python
   para análisis/ML), independencia de despliegue.
3. **POST /sync acepta 202 Accepted, no 200** — Indica que se aceptó
   pero el procesamiento es async; alinea con cómo el backend lo
   llamará (fire-and-forget, no bloquea el flujo principal).
4. **Pydantic 2.9** — Validación estricta automática para los SyncEvent
   evita corrupciones de estado por payloads malformados.
5. **No autenticación en MVP** — Twin va en VPC interna o tras firewall
   de Fly. Hito 5.4.3 añadirá `X-Internal-Key` cuando reciba telemetría
   real.

## Próximo

Hito 5.4.2 — Pipeline sim-to-real: el `rl_service` consume
`/state` del twin como fuente de entrenamiento, y a su vez exporta el
modelo entrenado para que el backend lo use en `RankingService`.
