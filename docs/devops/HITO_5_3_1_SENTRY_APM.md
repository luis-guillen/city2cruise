# Hito 5.3.1 — APM Sentry (frontend + backend)

> Status: **Done** (2026-04-28)
> Fase: 5.3 — Observabilidad
> Sucesor: 5.3.2 (métricas Prometheus + Grafana)

## Objetivo

Captura automática de errores y trazas de rendimiento en frontend y
backend, con scrubbing de PII, bajo coste (free tier 5k events/mes).

## Entregables

| Capa | Archivo | Función |
|---|---|---|
| Backend | `backend/src/observability/sentry.ts` | initSentry() idempotente |
| Backend | `backend/src/index.ts` (top) | initSentry ANTES de cualquier otro import |
| Backend | `backend/src/server.ts` | Sentry.setupExpressErrorHandler antes del globalErrorHandler |
| Frontend | `cruise-connect-main/src/observability/sentry.ts` | init React + browserTracing + replayOnError |
| Frontend | `cruise-connect-main/src/main.tsx` | init + ErrorBoundary envolviendo `<App />` |

## Configuración por entorno

Variables nuevas (ya en `envs/{staging,production}.env.example`):

| Variable | dev | staging | production |
|---|---|---|---|
| `SENTRY_DSN` (backend) | unset (noop) | DSN proyecto staging | DSN proyecto prod |
| `VITE_SENTRY_DSN` (frontend) | unset | DSN proyecto staging-fe | DSN proyecto prod-fe |
| `SENTRY_ENVIRONMENT` | development | staging | production |
| `SENTRY_TRACES_SAMPLE_RATE` | 1.0 | 1.0 | 0.1 |
| `SENTRY_PROFILES_SAMPLE_RATE` | 0 | 0 | 0 (subir a 0.1 si compensa) |
| Replay frontend (sesiones) | 0% | 0% | 0% |
| Replay frontend (en error) | 100% | 100% | 100% |

## Defensa de privacidad

Tanto backend como frontend filtran en `beforeSend`:

- `event.user.ip_address` → eliminada (cumplimiento GDPR sin DPA con Sentry).
- `event.request.headers.authorization` y `cookie` → eliminadas (defensa en profundidad por si pasaran).
- Replay frontend: `maskAllText: true`, `blockAllMedia: true` por defecto.

## Filtrado de ruido

| Tipo | Backend ignora | Frontend ignora |
|---|---|---|
| Connection-reset | `ECONNRESET`, `ETIMEDOUT` | — |
| HTTP 4xx esperables | `/Bad Request/i` | — |
| Extensiones navegador | — | `chrome-extension://`, `moz-extension://` |
| Network noise | — | `Network request failed`, `Failed to fetch`, `Load failed` |
| ResizeObserver loop | — | dos variantes (no afecta UX) |

## Verificación local sin DSN

`initSentry()` devuelve `false` si no hay DSN y no rompe nada — los
tests siguen pasando (14 backend / 79 frontend) y la app arranca igual.
Tests pasan, `tsc --noEmit` limpio en ambos lados.

## Integraciones automáticas (gracias al SDK v8 + OTel)

Backend:
- HTTP requests/responses (Node http module)
- Express middleware timing
- Postgres queries (instrumentado via OTel)
- Console errors

Frontend:
- React component render performance (browserTracingIntegration)
- Fetch/XHR
- Navigation transitions (history)
- Console errors
- Unhandled promise rejections

## Uso para añadir contexto manual

```ts
// Backend: dentro de un handler
import { Sentry } from '../observability/sentry';
Sentry.setUser({ id: req.user?.id, role: req.user?.role });
Sentry.addBreadcrumb({ category: 'auth', message: 'login attempt', level: 'info' });

// Frontend: en un hook
import { Sentry } from '@/observability/sentry';
Sentry.setTag('locker_id', lockerId);
Sentry.captureMessage('Driver accepted request', 'info');
```

## Coste

Free tier Sentry: **5.000 errors / mes + 10k transactions / mes**.
Con `tracesSampleRate=0.1` en prod estimamos:
- ~1.000 errors/mes (mucha tolerancia)
- ~3.000 transactions/mes a 50 req/día

→ **$0/mes** previsto en MVP.

## Próximo

Hito 5.3.2 — Prometheus métricas técnicas + Grafana dashboard.
Sentry cubre errores y trazas; Prometheus cubrirá métricas de salud
(req/s, p95, queue depth, RAM, CPU, conexiones DB) que Sentry no hace
bien.
