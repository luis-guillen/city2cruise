# Hito 5.3.5 — Logging centralizado

> Status: **Done** (2026-04-28)
> Fase: 5.3 — Observabilidad
> Predecesor: 5.3.4 (alerting)
> Sucesor: 5.3.6 (health checks)

## Decisión

**Logs como stream estructurado a stdout, recolectado por el agent del
hosting (Fly.io → Better Stack / Grafana Loki).**

- Sin SDK adicional ni HTTP push: 12-factor compliant.
- Cambiar de proveedor (Better Stack ↔ Loki ↔ CloudWatch ↔ Datadog) no
  toca código de aplicación, sólo el agent de Fly.

## Entregables

| Archivo | Función |
|---|---|
| `backend/src/utils/logger.ts` | pino con base{env, service, version}, redact de credenciales |
| `backend/src/middleware/requestId.ts` | request_id en cada petición + access log JSON |
| `backend/src/server.ts` | requestIdMiddleware aplicado primero |

## Estructura JSON resultante

Cada línea de log es un JSON parseable por cualquier colector:

```json
{
  "level": 30,
  "time": "2026-04-28T13:45:12.123Z",
  "env": "production",
  "service": "city2cruise-backend",
  "version": "0.1.0",
  "request_id": "9b2d4f1a-...",
  "method": "POST",
  "path": "/api/requests",
  "status": 201,
  "duration_ms": 142.7,
  "ip": "203.0.113.5",
  "msg": "http_request"
}
```

Para correlacionar logs de un mismo request a través de servicios, los
clientes pueden enviar `x-request-id` y se preserva. Si no lo envían,
generamos un UUID v4 y lo devolvemos en el response header (también
útil para soporte: el usuario reporta el ID y on-call lo busca).

## Defensa de privacidad (redact)

Pino redacta antes de serializar (más seguro que post-procesar):

| Path | Acción |
|---|---|
| `req.headers.authorization` | `[REDACTED]` |
| `req.headers.cookie` | `[REDACTED]` |
| `req.body.password` | `[REDACTED]` |
| `req.body.currentPassword` | `[REDACTED]` |
| `req.body.newPassword` | `[REDACTED]` |
| `password`, `*.password` | `[REDACTED]` |
| `jwt`, `token`, `secret` | `[REDACTED]` |

Esto cierra una clase entera de filtraciones de credenciales por logs
verbosos. Defensa en profundidad junto con el `beforeSend` de Sentry
(Hito 5.3.1).

## Configuración del colector (Fly.io)

Fly.io ofrece dos rutas:

### Ruta A: Better Stack (recomendado MVP — free 1GB/mes)

```bash
flyctl secrets set --app city2cruise-production-backend \
  BETTER_STACK_SOURCE_TOKEN="<token>"

# fly.toml ya incluye la siguiente sección:
# [[services.logs]]
#   driver = "logs"
```

Better Stack consume directamente de los logs de Fly via API; no se
necesita agent en el contenedor.

### Ruta B: Grafana Cloud Loki (free 50GB/mes pero requiere Promtail)

Setup más complejo (sidecar Promtail). Diferir hasta tener
>500 req/min consistentes para que compense.

## Qué NO va al colector

- **Nada en `dev`** — pino-pretty a stdout local.
- **Body de requests** — sólo metadata (method, path, status,
  duration). Si quieres ver body para debug, usa Fly logs en directo
  (`flyctl logs`) que no van al colector.
- **Cuerpos de respuesta** — idem.
- **Trazas completas** — Sentry ya las tiene (Hito 5.3.1). No
  duplicar coste.

## Búsquedas útiles (Better Stack query syntax)

```
# Errores 5xx en últimas 6h
status:>=500

# Latencia >1s
duration_ms:>1000

# Un request específico (cuando soporte lo pide)
request_id:"9b2d4f1a-..."

# Errores de un user concreto
level:>=40 AND user_id:1234

# Endpoint que más errores genera
status:>=500 | stats count by path | sort -count
```

## Verificación

- tsc --noEmit limpio.
- 17 tests pasan (sin DB).
- Local: arrancar backend, hacer un request, ver pino-pretty con
  request_id en stdout.
- Producción: tras configurar Better Stack source token y desplegar,
  abrir dashboard y filtrar `service:city2cruise-backend env:production`.

## Próximo

Hito 5.3.6 — Health checks (`/health` simple + `/ready` con checks de
DB y Redis). Ya hay `/api/health` básico; falta `/ready` y formalizar
el contrato.
