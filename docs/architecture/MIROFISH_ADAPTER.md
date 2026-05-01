# MiroFish Adapter Spec

## Objetivo

Integrar `MiroFish` como proveedor alternativo del gemelo digital sin romper el contrato actual de `rl_service`.

El selector será:

- `TWIN_PROVIDER=internal`
- `TWIN_PROVIDER=mirofish`

`TwinClient` seguirá siendo la fachada estable. Cuando el proveedor sea `mirofish`, la lógica HTTP real vivirá en `MiroFishTwinAdapter`.

## Contrato Real De MiroFish

MiroFish no expone un `POST /scenario/run` nativo en la rama principal que revisamos. El flujo real de simulación es un lifecycle con estos endpoints:

- `GET /health`
- `POST /api/simulation/create`
- `POST /api/simulation/prepare`
- `POST /api/simulation/prepare/status`
- `GET /api/simulation/<simulation_id>`

La base del backend está documentada en el repo en `http://localhost:5001` para desarrollo y usa blueprints bajo `/api/*`.

## Auth

En el estado actual del repo no vimos auth obligatoria activa en esos endpoints.

El adapter debe soportar auth configurable por compatibilidad y hardening:

- `Authorization: Bearer ${MIROFISH_API_KEY}`
- `X-API-Key: ${MIROFISH_API_KEY}`

Si `MIROFISH_API_KEY` no está presente, el adapter no enviará cabeceras de auth.

## Variables De Entorno

Variables nuevas que usa el adapter:

- `TWIN_PROVIDER=internal|mirofish`
- `MIROFISH_BASE_URL`
- `MIROFISH_API_KEY`
- `MIROFISH_PROJECT_ID`
- `MIROFISH_GRAPH_ID` opcional
- `MIROFISH_SIMULATION_ID` opcional

Regla recomendada:

1. `internal` es el valor por defecto.
2. `mirofish` solo se activa cuando el entorno esté preparado.
3. `MIROFISH_PROJECT_ID` es requerido para orquestar `create_simulation`.

## Adapter Contract

`MiroFishTwinAdapter` debe hacer esto:

1. `health()`
   - llama `GET /health`

2. `create_simulation()`
   - llama `POST /api/simulation/create`
   - requiere `project_id`
   - puede pasar `graph_id` si está disponible

3. `prepare_simulation()`
   - llama `POST /api/simulation/prepare`
   - soporta `entity_types`, `use_llm_for_profiles`, `parallel_profile_count`, `force_regenerate`

4. `poll_prepare_status()`
   - llama `POST /api/simulation/prepare/status`
   - espera `ready` o `completed`

5. `get_state()`
   - llama `GET /api/simulation/<simulation_id>`
   - si no se pasa `simulation_id`, usa el último creado o `MIROFISH_SIMULATION_ID`

6. `run_scenario()`
   - orquesta `create -> prepare -> poll -> get_state`
   - devuelve un resumen compatible con `train_with_twin_scenarios()`
   - incluye un `state_tensor` normalizado con:
     - `drivers`
     - `urgency`
     - `lockers`
     - `demandClusters`
     - `activeRequestCount`

## Mapeo Hacia `StateTensor`

El adapter traduce la respuesta del sim backend a un `StateTensorInput` interno:

- `drivers`:
  - se usa `drivers`, `driver_states` o `agents` si existen
  - se normalizan `lat`, `lon`, `speedMps`, `sigmaM` y vectores

- `urgency`:
  - se usa `urgency`, `urgency_scores` o se deriva de `requests`

- `lockers`:
  - se deriva de `lockers`, `slots` o de `aggregates`

- `demandClusters`:
  - se usa `demandClusters`, `demand_clusters` o `clusters`

- `activeRequestCount`:
  - se deriva de `requests` o `aggregates.requests_active`

## Contract Tests

La integración debe quedar blindada con tests de contrato usando `httpx.MockTransport`:

- `health` responde bien
- `create_simulation` envía `project_id` y `graph_id`
- `prepare_simulation` manda `simulation_id`
- `poll_prepare_status` resuelve `ready`
- `get_state` devuelve el snapshot de la simulación
- `run_scenario` produce `state_tensor` y métricas de resumen
- el selector `TWIN_PROVIDER=mirofish` cambia la implementación sin tocar el contrato público

## Criterio De Aceptación

La integración se considera lista cuando:

- `TWIN_PROVIDER=internal` sigue funcionando exactamente como antes
- `TWIN_PROVIDER=mirofish` activa el adapter nuevo
- `train_from_twin` sigue devolviendo un resumen válido
- los contract tests pasan
- la configuración de deploy expone las variables nuevas

## Smoke Operativo

Cuando haya una instancia viva de MiroFish disponible, el check recomendado es:

```bash
python scripts/smoke_mirofish.py \
  --base-url "$MIROFISH_BASE_URL" \
  --project-id "$MIROFISH_PROJECT_ID" \
  --graph-id "$MIROFISH_GRAPH_ID" \
  --api-key "$MIROFISH_API_KEY"
```

Si quieres un smoke autocontenido que genere un proyecto local más rico y construya el grafo antes de ejecutar el flujo, usa:

```bash
python scripts/smoke_mirofish.py \
  --base-url "$MIROFISH_BASE_URL" \
  --api-key "$MIROFISH_API_KEY" \
  --bootstrap
```

Ese script valida:

- `GET /health`
- `POST /api/simulation/create`
- `POST /api/simulation/prepare`
- `POST /api/simulation/prepare/status`
- `GET /api/simulation/<simulation_id>`
- el flujo completo de `run_scenario()`

## Nota Operativa

Como el repo actual de MiroFish está orientado a simulaciones de propósito general y no a logística portuaria, el adapter se limita a traducir la respuesta del lifecycle de simulación al `StateTensor` que consume `rl_service`.
Si más adelante MiroFish expone campos más específicos para la torre o para el dominio de puertos, el mapping se podrá enriquecer sin cambiar el contrato externo del RL.
