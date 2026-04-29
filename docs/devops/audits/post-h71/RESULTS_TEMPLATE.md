# H-7.1 — Resultados k6 contra staging

**Fecha de ejecución:** _YYYY-MM-DD_
**Operador:** _alias_
**Tag de imagen testeada:** _v_x.y.z / sha-_xxxxx
**Staging URL:** _https://city2cruise-staging.fly.dev_

## Comandos ejecutados

```bash
# Suite oficial (100 VUs constantes + spike 200 VUs)
BASE_URL=https://city2cruise-staging.fly.dev \
CLIENT_EMAIL=loadtest@staging.city2cruise.es \
CLIENT_PASSWORD=$(op read 'op://staging/loadtest/password') \
./scripts/k6-phase4.sh

# Reporte HTML con dashboard
K6_WEB_DASHBOARD=true \
K6_WEB_DASHBOARD_EXPORT=docs/devops/audits/post-h71/dashboard.html \
BASE_URL=https://city2cruise-staging.fly.dev \
k6 run --out json=docs/devops/audits/post-h71/100c-results.json \
       k6/phase4-100c.js
```

## Resultados (rellenar tras la corrida)

### 100 VUs constantes — `phase4-100c.js`

| Métrica | Objetivo | Resultado | Veredicto |
| --- | --- | --- | --- |
| `http_req_duration` p95 | < 500 ms | _XX ms_ | ✅ / ❌ |
| `http_req_duration` p99 | < 1000 ms | _XX ms_ | ✅ / ❌ |
| `http_req_failed` rate | < 1 % | _X.XX %_ | ✅ / ❌ |
| `http_errors_5xx` count | == 0 | _N_ | ✅ / ❌ |
| `auth_failures` rate | < 5 % | _X.XX %_ | ✅ / ❌ |
| Pico VUs simultáneos | 100 | _100_ | ✅ |

### Spike 200 VUs — `phase4-spike.js`

| Métrica | Objetivo | Resultado | Veredicto |
| --- | --- | --- | --- |
| Recuperación post-spike (p95) | < 800 ms | _XX ms_ | ✅ / ❌ |
| `http_req_failed` durante spike | < 5 % | _X.XX %_ | ✅ / ❌ |
| OOM kills (Fly logs) | 0 | _N_ | ✅ / ❌ |

### Métricas de Fly.io durante la corrida

| Métrica | Objetivo | Pico observado |
| --- | --- | --- |
| `process_resident_memory_bytes` | < 380 MB (de 512 MB) | _XX MB_ |
| Event loop lag (p99) | < 100 ms | _XX ms_ |
| CPU per machine | < 80 % | _XX %_ |
| 5xx en logs Fly | 0 | _N_ |

## Anomalías observadas

_Listar incidencias durante la corrida (errores intermitentes, picos
extraños, alertas que se dispararon, etc.)_

## Adjuntos

- [ ] `100c-summary.json`
- [ ] `100c-stdout.txt`
- [ ] `spike-summary.json`
- [ ] `spike-stdout.txt`
- [ ] `100c-results.json`
- [ ] `dashboard.html`
- [ ] Capturas Grafana del periodo (latencia, RSS, event loop).

## Decisión

- [ ] **PASS**: SLOs cumplidos. Se promueve la imagen a producción.
- [ ] **FAIL**: SLO incumplido en _métrica_. Acciones: _…_

Firma: _alias_, _fecha_.
