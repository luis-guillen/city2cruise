# Hito 5.3.6 — Health checks (`/health` y `/ready`)

> Status: **Done** (2026-04-28)
> Fase: 5.3 — Observabilidad
> Predecesor: 5.3.5 (logging)
> Sucesor: 5.4.x (Digital Twin)

## Distinción liveness vs readiness

| Endpoint | Pregunta | Falla si | Quién lo usa |
|---|---|---|---|
| `GET /health` | ¿proceso vivo? | el proceso muere o cuelga el event loop | ALB target group, Fly health check (rapidisimo, **no** bajará la VM si DB cae) |
| `GET /ready` | ¿puede atender tráfico real? | DB o Redis caídos | k8s readinessProbe, monitor externo (Better Stack uptime) |

Esto evita el antipatrón de "DB cae → ALB marca todas las VMs enfermas
→ se reinician en bucle → el problema empeora".

## Endpoints

### `GET /health`

```json
HTTP 200
{
  "status": "ok",
  "uptime_seconds": 12345,
  "version": "0.1.0",
  "env": "production",
  "timestamp": "2026-04-28T13:50:00.000Z"
}
```

- **No depende de DB ni Redis.**
- Retorna el uptime para depurar si la VM se ha reiniciado.
- El `version` ayuda a confirmar qué imagen está corriendo
  (post-deploy verification).

### `GET /ready`

```json
HTTP 200 (todo OK)
{
  "status": "ready",
  "uptime_seconds": 12345,
  "timestamp": "...",
  "checks": {
    "database": { "ok": true, "latency_ms": 12 },
    "redis":    { "ok": true, "latency_ms": 3 }
  }
}

HTTP 503 (algo caído)
{
  "status": "not_ready",
  "checks": {
    "database": { "ok": false, "latency_ms": 5001, "error": "timeout exceeded when trying to connect" },
    "redis":    { "ok": true, "latency_ms": 3 }
  }
}
```

Latencia incluida para hacer obvio si la base/cache empieza a degradarse
(útil para alertas posteriores).

## Wiring

`backend/src/server.ts`:

1. `requestIdMiddleware` (correlation)
2. `healthRouter` ← **antes** del rate limiter
3. rate limiter
4. body parsers
5. metrics middleware
6. routers de aplicación

Razón: las health checks no deben gastar el bucket de rate-limit ni
requerir auth.

## Probes en Fly.io (`fly.toml`)

Recomendado (no incluido en este commit, depende de despliegue real):

```toml
[[services.tcp_checks]]
  interval = "10s"
  timeout = "2s"

[[services.http_checks]]
  interval = "10s"
  grace_period = "5s"
  method = "get"
  path = "/health"
  protocol = "http"
  timeout = "2s"

# /ready más infrecuente porque toca DB
[[services.http_checks]]
  interval = "60s"
  grace_period = "30s"
  method = "get"
  path = "/ready"
  protocol = "http"
  timeout = "8s"
```

`/ready` con grace_period largo: tras un deploy nuevo, dale tiempo a
Postgres para aceptar la conexión.

## Tests

```
PASS src/__tests__/health.test.ts
  Hito 5.3.6 — /health (liveness)
    ✓ responde 200 con status ok y campos esperados
    ✓ liveness no requiere DB ni Redis (responde aunque caigan)

Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
```

`/ready` no tiene unit test porque requiere DB+Redis reales — se cubre
en los tests de integración (CI con servicios docker postgres+redis).

## Acopla con

- **Hito 5.2.4** (DR runbook): los pasos de "modo mantenimiento" usan
  `flyctl scale count 0` para que `/health` no responda y el ALB saque
  el backend del rotación.
- **Hito 5.3.4** (alerting): la regla `BackendDown` usa
  `up{job="city2cruise-backend"} == 0` que viene del scrape de
  `/metrics`; complementario a estas probes.

## Próximo

Fase 5.4 — Digital Twin: Hito 5.4.1 deploy del Miro Fish stub e
integración inicial.
