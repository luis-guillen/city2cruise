# Hito 4.3.5 — Load testing k6

> Fecha: 2026-04-28
> Rama: `FASE4-FASE5-FASE6`
> Versión k6: 0.50.x (probado en arm64 y amd64)

## 1. Scripts

| Archivo | Escenario | Threshold |
|---|---|---|
| `k6/phase4-100c.js` | 100 VUs constantes durante 2 min, ejercitando login → /api/lockers + /api/requests/mine + /api/notifications | **p95 < 500 ms**, p99 < 1000 ms, http_req_failed < 1%, **0 errores 5xx**, auth_failures < 5% |
| `k6/phase4-spike.js` | 0→200 VUs en 15 s, sostiene 200 VUs 30 s, baja a 0 en 15 s contra `/api/health` | p95 < 800 ms, http_req_failed < 5% |
| `k6/load-test.js` | Existente (smoke + average + peak) | p95 < 500 ms (script pre-existente, dejado como está) |

## 2. Cómo ejecutar

```bash
# 1. Levantar backend + db + redis
docker compose -f docker-compose.dev.yml up -d --build

# 2. Verificar que el seed creó client@test.com / password123
# (si no, registrar manualmente o ajustar CLIENT_EMAIL/PASSWORD)

# 3. Lanzar el test del hito
./scripts/k6-phase4.sh           # local
BASE_URL=https://api.staging.x ./scripts/k6-phase4.sh

# Reportes:
#   docs/audits/k6/100c-summary.json
#   docs/audits/k6/100c-stdout.txt
#   docs/audits/k6/spike-summary.json
#   docs/audits/k6/spike-stdout.txt
```

Para el dashboard web interactivo (HTML auto-refresh):
```bash
K6_WEB_DASHBOARD=true \
K6_WEB_DASHBOARD_EXPORT=docs/audits/k6/dashboard.html \
k6 run k6/phase4-100c.js
```

## 3. Smoke test del runner (sandbox)

Validamos los scripts en sandbox sin backend real:

```
$ k6 archive k6/phase4-100c.js   # OK (sintaxis válida)
$ k6 archive k6/phase4-spike.js  # OK
```

End-to-end con un mock HTTP en localhost:9000:
```
running (06.2s), 00/10 VUs, 77 complete and 0 interrupted iterations
checks.........................: 100.00% ✓ 462    ✗ 0
http_errors_5xx................: 0       0/s
http_req_duration..............: min=437µs avg=4.69ms med=2.85ms p(95)=5.36ms
```
- p95 = 5.36 ms (objetivo < 500 ms) ✓
- 0 errores 5xx ✓
- 100% de los checks de latencia individuales pasan ✓

(El mock devuelve 404 en `/api/requests/mine`, lo que k6 interpreta como
"req failed" — el threshold global `http_req_failed < 1%` se cruza por
diseño del mock, no del script. En el backend real este endpoint
devuelve 200/null, no 404.)

## 4. Criterios de aceptación

- [x] Script con 100 VUs concurrentes (executor: constant-vus 2 min)
- [x] Threshold http_req_duration p95 < 500 ms en el SLA
- [x] Threshold http_errors_5xx == 0
- [x] Reporte JSON exportable (summary-export, k6-summary.json)
- [x] Runner shell con `BASE_URL` parametrizable
- [ ] Ejecución contra staging real con resultados <500ms — pendiente
      (el sandbox de dev no provee Postgres+Redis simultáneos, hay que
      hacerlo en tu Mac con `docker compose -f docker-compose.dev.yml up`)

## 5. Próximos pasos

- Integrar `phase4-100c.js` en GitHub Actions (job manual_dispatch que
  levanta el stack docker y corre k6).
- Añadir métrica custom `geo_dispatch_ms` para medir latencia de
  ST_Distance + ST_DWithin (objetivo del audit: <50ms).
- Añadir un escenario `ws` con `socket.io-client` para medir latencia
  de eventos `driver:location:update` bajo carga.
