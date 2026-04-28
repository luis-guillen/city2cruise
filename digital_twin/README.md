# Digital Twin — City2Cruise

> Hito 5.4.1: stub funcional desplegable
> Hito 5.4.2: pipeline sim-to-real con `rl_service`
> Hito 5.4.3: ingesta telemetría real
> Hito 5.4.4: panel "Torre de Control" en frontend

## Qué es

Réplica virtual del sistema City2Cruise que mantiene en tiempo real:

- Estado de cada **locker** (libre / reservado / ocupado / averiado)
- Posición y estado de cada **driver** (online / busy / available / offline)
- **Requests** activas y su fase de cascada
- Métricas agregadas: ocupación de la red, latencia de match, demanda
  por puerto

Sirve para:

1. **Simular** escenarios "what-if" (¿qué pasa si quito 5 lockers en
   Las Canteras?) sin tocar producción.
2. **Entrenar** el agente RL (`rl_service`) sobre escenarios sintéticos
   que reflejan la dinámica real (sim-to-real).
3. **Mostrar** una vista agregada del estado actual a operaciones
   ("torre de control").

## Stack

- Python 3.11, FastAPI, asyncio
- Estado en memoria (RAM) con snapshots opcionales a Postgres
- WebSocket para streaming a frontend admin
- Cliente HTTP para sincronizarse con backend (`/api/internal/twin/sync`)

## Endpoints

| Método | Path | Función |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/state` | Snapshot completo del gemelo |
| GET | `/state/lockers` | Estado de todos los lockers |
| GET | `/state/drivers` | Posiciones y estado de drivers |
| POST | `/sync` | Backend empuja un evento (locker_open, request_created, ...) |
| POST | `/scenario/run` | Ejecuta un escenario de simulación |
| WS | `/ws/dashboard` | Stream de cambios en tiempo real para Torre de Control |

## Estado actual (Hito 5.4.1)

**Stub funcional** — endpoints implementados con datos en memoria
inicializados desde un seed estático. Sin integración real con backend
todavía (eso viene en 5.4.2/5.4.3).

## Cómo correr local

```bash
cd digital_twin
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8090

curl http://localhost:8090/health
curl http://localhost:8090/state | jq .
```

## Despliegue (fly.toml propio)

```bash
cd digital_twin
flyctl launch --name city2cruise-twin --no-deploy
flyctl secrets set --app city2cruise-twin BACKEND_URL=https://city2cruise-production-backend.fly.dev
flyctl deploy
```
