# Hito H-7.1 — Suite k6 contra staging (I-04)

**Severidad:** INFO
**Owner:** Backend / DevOps
**Esfuerzo:** ~0.5 jornada
**Estado:** ✅ Code-complete; **ejecución diferida al owner local** (el
sandbox no tiene acceso a staging real ni a `k6`).

## Estado de la suite

| Artefacto | Existe | Notas |
| --- | --- | --- |
| `scripts/k6-phase4.sh` | sí | Acepta `BASE_URL=` para apuntar a cualquier entorno; vuelca a `docs/audits/k6/`. |
| `k6/phase4-100c.js` | sí | 100 VUs constantes 2 min; thresholds p95<500 ms, p99<1000 ms, fail<1 %, 0 5xx. |
| `k6/phase4-spike.js` | sí | Spike a 200 VUs con criterio de recuperación. |
| `k6/phase6-*.js` | sí | Bench, soak, stress, websocket — opcionales para subiendo cobertura. |
| `observability/prometheus.scrape.yml` | sí | Métricas Fly publicadas para Grafana. |

## Acción del owner

```bash
# 1. Asegurar que staging está al día con la imagen testeada.
flyctl status --app city2cruise-staging-backend

# 2. Ejecutar suite oficial.
BASE_URL=https://city2cruise-staging.fly.dev \
CLIENT_EMAIL=loadtest@staging.city2cruise.es \
CLIENT_PASSWORD="$(op read 'op://staging/loadtest/password')" \
./scripts/k6-phase4.sh

# 3. Generar dashboard HTML para adjuntar al hito.
K6_WEB_DASHBOARD=true \
K6_WEB_DASHBOARD_EXPORT=docs/devops/audits/post-h71/dashboard.html \
BASE_URL=https://city2cruise-staging.fly.dev \
k6 run --out json=docs/devops/audits/post-h71/100c-results.json \
       k6/phase4-100c.js

# 4. Capturar pantalla Grafana del periodo (RSS, p95, event-loop lag).

# 5. Rellenar docs/devops/audits/post-h71/RESULTS_TEMPLATE.md y
#    commit/tag.
```

## Plantilla de evidencia

[`docs/devops/audits/post-h71/RESULTS_TEMPLATE.md`](audits/post-h71/RESULTS_TEMPLATE.md)
ya creada. Incluye matriz de SLOs (p95<500 ms, p99<1000 ms, fail<1 %, 0
5xx), métricas Fly (RSS<380 MB, event loop p99<100 ms), recovery
post-spike (<800 ms), checklist de adjuntos y bloque de decisión
PASS/FAIL.

## Trazabilidad

- Auditoría: hallazgo `I-04`.
- Hoja de ruta: capítulo 7, hito H-7.1.
- Tag: `hito-H-7.1-completed` (la **evidencia firmada** se añade tras la
  ejecución real con un commit follow-up `docs(audit): add H-7.1 k6
  evidence`).
