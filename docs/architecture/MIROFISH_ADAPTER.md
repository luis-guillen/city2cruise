# MiroFish Adapter Spec

## Objetivo

Este documento define cómo integrar un proveedor externo de twin llamado `MiroFish` sin reescribir la lógica AI/RL ya cerrada. La integración debe preservar el contrato actual consumido por `rl_service` y dejar al `TwinClient` como punto único de adaptación.

La idea es simple:

- `rl_service` sigue hablando con un `TwinClient`
- el proveedor se selecciona por configuración
- si el proveedor es `mirofish`, solo cambian `base_url`, autenticación y mapping de schemas

## Estado actual

El contrato interno vigente está implementado en [rl_service/twin_bridge.py](/Users/luisguillen/Documents/Reker/APP_TRASNPORTE_LOCKERS_BARCELONA/rl_service/twin_bridge.py:1).

Hoy `TwinClient` espera estos endpoints:

- `GET /health`
- `GET /state`
- `GET /state/aggregates`
- `POST /scenario/run`

Y consume respuestas JSON orientadas a:

- snapshot completo del twin
- agregados operativos
- ejecución de escenarios de simulación

## Estrategia de adapter

`TwinClient` debe seguir siendo la fachada estable para `rl_service`.

La integración con `MiroFish` no debería cambiar:

- [rl_service/main.py](/Users/luisguillen/Documents/Reker/APP_TRASNPORTE_LOCKERS_BARCELONA/rl_service/main.py:1)
- el endpoint `POST /train_from_twin`
- la lógica `train_with_twin_scenarios(...)`

Solo debería añadir:

- selección de proveedor
- autenticación para `MiroFish`
- funciones de mapping `MiroFish -> internal schema`

## Variables de entorno

Variables nuevas propuestas:

- `TWIN_PROVIDER=internal|mirofish`
- `MIROFISH_BASE_URL=https://...`
- `MIROFISH_API_KEY=...`

Variables ya existentes que se mantienen:

- `TWIN_URL`

Regla de resolución recomendada:

1. Si `TWIN_PROVIDER=internal`, usar `TWIN_URL`
2. Si `TWIN_PROVIDER=mirofish`, usar `MIROFISH_BASE_URL`
3. Si no hay `TWIN_PROVIDER`, asumir `internal` por compatibilidad

## Endpoints esperados de MiroFish

Se asume que `MiroFish` puede exponer una API equivalente, aunque no necesariamente idéntica, a estos contratos:

- `GET /health`
- `GET /state`
- `GET /state/aggregates`
- `POST /scenario/run`

Si `MiroFish` expone nombres distintos, el adapter debe resolverlo internamente. El resto del sistema no debe enterarse.

Contrato lógico esperado:

- `GET /state`
  - snapshot de drivers, demanda, lockers, urgencia y requests activas
- `GET /state/aggregates`
  - KPIs de estado resumidos para observabilidad o entrenamiento
- `POST /scenario/run`
  - ejecución de escenario con parámetros de duración, tasa de demanda, flota y seed

## Mapping de schemas

El adapter debe transformar la respuesta de `MiroFish` al contrato interno que hoy espera `TwinClient`.

Campos mínimos que el flujo actual necesita conservar:

- `requests_simulated`
- métricas agregadas por escenario
- estado legible para entrenamiento y validación

Mapping orientativo:

- `MiroFish vessel urgency` -> `urgency`
- `MiroFish fleet positions` -> `drivers`
- `MiroFish storage/slots` -> `lockers`
- `MiroFish demand hotspots` -> `demandClusters`
- `MiroFish simulation summary` -> `scenario/run` result

Si `MiroFish` devuelve más detalle, el adapter puede ignorarlo. Si devuelve menos, debe completar defaults explícitos o fallar con error claro.

## Autenticación

Para `MiroFish` se recomienda:

- header `Authorization: Bearer ${MIROFISH_API_KEY}`

Alternativas aceptables si el proveedor lo exige:

- `X-API-Key: ${MIROFISH_API_KEY}`
- firma HMAC adicional

La autenticación debe vivir dentro del adapter, no en `main.py`.

## Manejo de errores

Requisitos del adapter:

- timeout explícito
- `raise_for_status()` en respuestas no `2xx`
- errores de mapping con contexto suficiente
- degradación limpia hacia `502` en `rl_service` cuando el twin externo no sea accesible

No se debe mezclar lógica de negocio RL con parsing específico de `MiroFish`.

## Diseño recomendado

Opción mínima:

- mantener una sola clase `TwinClient`
- añadir selección por `TWIN_PROVIDER`
- introducir helpers privados de mapping para `mirofish`

Opción más limpia si se quiere crecer:

- `BaseTwinClient`
- `InternalTwinClient`
- `MiroFishTwinClient`

La segunda opción es preferible si `MiroFish` se desvía bastante del contrato interno.

## Plan de contract tests

La integración no debe validarse solo con tests e2e contra un proveedor real. Debe existir una capa de contract tests con mock.

Cobertura mínima recomendada:

1. `health`
   - `MiroFish` responde `200`
   - el adapter devuelve payload compatible

2. `get_state`
   - respuesta completa de `MiroFish`
   - mapping correcto a snapshot interno

3. `get_aggregates`
   - mapping de KPIs y nombres de campos

4. `run_scenario`
   - el adapter envía duración, flota, tasa y `seed`
   - el resultado devuelve `requests_simulated` y métricas esperadas

5. autenticación
   - el mock debe verificar presencia del header requerido

6. errores
   - `401/403` del proveedor
   - `5xx` del proveedor
   - payload malformado
   - timeout

Herramienta recomendada:

- tests Python con `pytest`
- mock HTTP con `respx` o `httpx.MockTransport`

## Criterio de aceptación

La integración con `MiroFish` puede considerarse lista cuando:

- `train_from_twin` sigue funcionando sin cambios de API pública
- cambiar `TWIN_PROVIDER=internal` a `TWIN_PROVIDER=mirofish` no requiere tocar el resto del servicio
- los contract tests pasan
- los escenarios siguen produciendo métricas compatibles con `validate_ai_release.py`

## Impacto en roadmap

Este adapter es un follow-up post-roadmap. No bloquea el cierre de los hitos AI/RL ya implementados, pero deja preparado el punto de extensión correcto para sustituir el twin interno por un proveedor externo sin romper:

- entrenamiento sim-to-real
- release gate
- validación de escenarios
- futuras integraciones de torre/control operativo
