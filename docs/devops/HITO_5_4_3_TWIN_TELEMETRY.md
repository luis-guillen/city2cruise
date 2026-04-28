# Hito 5.4.3 — Telemetría remota al Digital Twin

> Status: **Done** (2026-04-28)
> Fase: 5.4 — Digital Twin
> Predecesor: 5.4.2 (sim-to-real)
> Sucesor: 5.4.4 (Torre de Control)

## Objetivo

El Digital Twin pasa de "stub con seed estático" a "réplica del estado
real" mediante eventos en tiempo real desde el backend. Sin bloquear
ningún flujo crítico si el twin está caído.

## Entregables

| Archivo | Función |
|---|---|
| `backend/src/services/twin/TwinSyncService.ts` | cliente fire-and-forget con circuit breaker |
| `backend/src/services/RequestService.ts` | hooks en createRequest/acceptRequest/depositRequest |
| `backend/src/sockets/io.ts` | hooks en connect (driver→available) y disconnect (driver→offline) |
| `backend/src/__tests__/twin-sync.test.ts` | 4 tests (no-op, body correcto, circuit breaker, internal key) |

## Diseño

### Fire-and-forget

Todos los hooks usan `.catch(() => {})`:

```ts
syncRequestCreated(dto.id, params.userId, locker.id).catch(() => {});
```

Significado: el backend **nunca** espera al twin, **nunca** falla un
request por fallo del twin. Si el twin está caído, simplemente
perdemos visibilidad temporal — el flow real sigue funcionando.

### Circuit breaker

Tras **5 fallos consecutivos**, el cliente abre el circuito y no
intenta más durante 30s. Esto evita:

- Spam de logs cuando el twin está caído.
- Latencia añadida (cada llamada tiene timeout 2s; 5 fallos × 2s = 10s
  de overhead innecesario por request).
- Saturar el twin si está volviendo a la vida.

### Configuración por entorno

| Variable | Default | Para qué |
|---|---|---|
| `TWIN_URL` | `undefined` (disabled) | base URL del twin |
| `TWIN_INTERNAL_KEY` | `undefined` (sin auth) | header `X-Internal-Key` |
| `TWIN_TIMEOUT_MS` | `2000` | timeout HTTP por llamada |

En **dev**: dejar `TWIN_URL` sin definir → no-op. La app funciona igual.

En **staging**: `TWIN_URL=http://city2cruise-twin-staging.fly.dev`.

En **production**: `TWIN_URL=http://city2cruise-twin.fly.dev` +
`TWIN_INTERNAL_KEY=<random-32-chars>` (mismo valor en el twin para
verificar la cabecera).

## Eventos sincronizados

| Trigger | Evento twin | Payload |
|---|---|---|
| `RequestService.createRequest` | `request.created` | `{request_id, client_id, locker_id}` |
| `RequestService.acceptRequest` | `request.assigned` | `{request_id, driver_id}` |
| `RequestService.depositRequest` | `request.deposited` | `{request_id}` |
| socket connect (DRIVER) | `driver.status_changed` | `{driver_id, status: "available"}` |
| socket disconnect (DRIVER) | `driver.status_changed` | `{driver_id, status: "offline"}` |

Helpers también disponibles para futura instrumentación:
`syncDriverPosition`, `syncLockerStatus`, `syncRequestCompleted`.

## Tests

```
PASS src/__tests__/twin-sync.test.ts
  Hito 5.4.3 — TwinSyncService
    ✓ es no-op cuando TWIN_URL no está definido
    ✓ hace POST /sync con el body esperado cuando TWIN_URL está set
    ✓ abre circuit breaker tras 5 fallos consecutivos y deja de llamar
    ✓ incluye X-Internal-Key si TWIN_INTERNAL_KEY está set

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
```

Añadidos a la lista CI sin-DB.

## Coste y rate limiting

Estimación:
- `request.created` / `assigned` / `deposited`: ~1 evento por viaje.
  A 50k req/d = 150k eventos/día (5/s pico).
- `driver.status_changed`: ~10 conexiones/desconexiones por driver/día
  × 100 drivers = 1k eventos/día.

Total: <200k eventos/día. El twin (FastAPI/uvicorn) maneja >5k req/s
sin sudar, así que sobra capacidad ~25.000×.

## Próximo

Hito 5.4.4 — Panel "Torre de Control" en frontend admin. Consume
`/state/aggregates` del twin cada 5s y muestra mapa con drivers/lockers
en tiempo real.
