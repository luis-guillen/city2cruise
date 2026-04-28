# Hito 5.4.2 — Pipeline Sim-to-Real (rl_service ↔ Digital Twin)

> Status: **Done** (2026-04-28)
> Fase: 5.4 — Digital Twin
> Predecesor: 5.4.1 (twin stub funcional)
> Sucesor: 5.4.3 (telemetría real al twin)

## Objetivo

Cerrar el ciclo:

```
   ┌────────────────┐ scenarios   ┌──────────────┐ trained model   ┌─────────┐
   │ digital_twin   │ ─────────▶  │ rl_service   │ ─────────────▶  │ backend │
   │ (escenarios    │             │ (PPO + train │   (RL_MODEL_    │ usa     │
   │  sintéticos)   │             │  /train_from │    PATH .zip)   │ ranking │
   │                │ ◀────── eventos sync ──── │              │ │         │
   └────────────────┘                            └──────────────┘ └─────────┘
```

## Entregables

| Archivo | Función |
|---|---|
| `rl_service/twin_bridge.py` | `TwinClient` (HTTP) + `train_with_twin_scenarios` |
| `rl_service/main.py` | endpoint `POST /train_from_twin` |
| `rl_service/tests/test_twin_bridge.py` | 5 tests con `httpx.MockTransport` |

## Cliente Twin

`TwinClient(base_url)` — controla con env `TWIN_URL` (default
`http://localhost:8090`):

- `client.health()` — verifica que el twin responde
- `client.get_state()` — snapshot completo del twin
- `client.get_aggregates()` — sólo métricas derivadas
- `client.run_scenario(name, duration_minutes, request_rate, drivers_online, seed)` — ejecuta una simulación

## Pipeline `train_with_twin_scenarios`

```python
result = train_with_twin_scenarios(
    agent=agent,
    n_scenarios=5,
    minutes_per_scenario=30,
    drivers_online=10,
    request_rate=2.0,
)
# result == {
#   "elapsed_seconds": 12.4,
#   "n_scenarios": 5,
#   "total_simulated_requests": 300,
#   "train_timesteps": 30000,        # 100 steps por request, mín 2k
#   "train_metrics": {...},
#   "scenarios": [{...}, ...]
# }
```

Heurística del timesteps: `max(2_000, total_simulated_requests * 100)`.
Garantiza floor para evitar runs triviales y escala con la complejidad
del escenario.

## Endpoint `POST /train_from_twin`

```
POST /train_from_twin
?n_scenarios=5
&minutes_per_scenario=30
&drivers_online=10
&request_rate_per_min=2.0
```

Verifica que el twin esté accesible (502 si no), bloquea si ya hay un
train en curso (409), y devuelve el resultado completo.

## Stub vs producción

Esta primera iteración **no extrae trajectorias del twin como replay
buffer**. Llama al `agent.train()` con timesteps proporcionales al
volumen simulado, asumiendo que el gym sintético interno del agente
captura la dinámica.

La extracción de trajectorias reales (state → action → reward →
next_state desde eventos del twin) se hará en **5.4.3** una vez que
el twin reciba telemetría real (no datos seed). En ese momento:

```python
# Pseudocódigo Hito 5.4.3
trajectories = []
for ev in twin.stream_events(since=t_minus_1h):
    s, a, r, s_next = encode_transition(ev)
    trajectories.append((s, a, r, s_next))
agent.replay_buffer.add(trajectories)
agent.train(total_timesteps=...)
```

## Tests

```
collected 5 items
rl_service/tests/test_twin_bridge.py::test_health PASSED
rl_service/tests/test_twin_bridge.py::test_get_state PASSED
rl_service/tests/test_twin_bridge.py::test_run_scenario_returns_metrics PASSED
rl_service/tests/test_twin_bridge.py::test_train_with_twin_scenarios_aggregates PASSED
rl_service/tests/test_twin_bridge.py::test_train_skips_if_no_train_method PASSED
============================== 5 passed ==============================
```

Nuevo job CI `rl-service-bridge` en `.github/workflows/ci.yml`.
Importante: **no** instala `stable-baselines3` ni `gymnasium` porque
el bridge no los necesita — sólo `httpx` + `pydantic` + `pytest`.
Esto mantiene el job CI rápido (<30s).

## Despliegue del modelo entrenado

Después de un train exitoso, el modelo queda persistido en
`RL_MODEL_PATH` (default `/tmp/cruise_dispatch_ppo.zip`). Para que el
backend lo use:

1. **Si rl_service y backend son la misma VM**: backend hace `POST
   /assign` y rl_service responde con el modelo recién entrenado
   (ya implementado en `RankingService` del backend).
2. **Si están separados** (caso producción real): el modelo se sube a
   un object storage (S3, R2) y rl_service lo descarga al arrancar:

   ```bash
   aws s3 cp /tmp/cruise_dispatch_ppo.zip \
     s3://city2cruise-models/$(date +%Y%m%d-%H%M%S).zip
   ```

   Esto se automatiza en Hito 5.4.3 con un cron `train-and-deploy.yml`.

## Próximo

Hito 5.4.3 — Conectar el flujo real:
1. Backend emite eventos a `digital_twin/sync` cuando ocurren cambios.
2. `digital_twin` deja de ser sólo simulación y refleja el estado real.
3. `rl_service.train_from_twin` se ejecuta nightly y actualiza el modelo
   en producción.
