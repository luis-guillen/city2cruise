# Hito H-1.3 — Contenedores no-root + HEALTHCHECK por imagen (S-03)

**Severidad:** ALTO
**Owner:** DevOps / Backend
**Esfuerzo:** ~2 horas
**Estado:** ✅ Code-complete (verificación con `docker run` queda al owner local — gap de sandbox idéntico al Cap. 0.3)

## Cambios

### `backend/Dockerfile`

- `COPY --chown=node:node` en cada `COPY` del runtime stage.
- `RUN npm cache clean --force` para reducir tamaño de imagen.
- `USER node` (UID 1000 en `node:20-alpine`) antes del `CMD`.
- `HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s` con
  `wget --spider -q http://localhost:9000/api/health`.

### `cruise-connect-main/Dockerfile`

- Imagen runtime cambiada de `nginx:alpine` a `nginxinc/nginx-unprivileged:alpine`.
- `USER 0` para colocar archivos + `chown -R 101:101 /usr/share/nginx/html`.
- `USER 101` (`nginx`) antes del `CMD`.
- `EXPOSE 8080` en lugar de 80.
- `HEALTHCHECK` análogo al backend, apuntando a `http://localhost:8080/`.

### `cruise-connect-main/nginx.conf`

- `listen 80` → `listen 8080` (la imagen unprivileged no puede ocupar puertos
  privilegiados <1024).

### `docker-compose.yml`

- `frontend.ports`: `"80:80"` → `"80:8080"` (host 80 sigue siendo el puerto
  publicado, contenedor escucha en 8080).
- `frontend.healthcheck.test`: URL ajustada a `http://localhost:8080`.

`docker-compose.dev.yml` no se toca porque su `frontend` arranca con
`vite run --host 0.0.0.0` desde el target `builder` y nunca cruza Nginx.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| `python3 -c "yaml.safe_load(open('docker-compose.yml'))"` | OK — `services: db, backend, frontend`; `frontend.ports=['80:8080']`; healthcheck en 8080. |
| Balanceo de `{}` en `nginx.conf` | 5 abiertos / 5 cerrados — OK. |
| `grep -rn 'listen 80\b'` (excluyendo `node_modules` y `.git`) | sin coincidencias en código. |
| `grep -rn 'localhost:80\b\|"80:80"'` | única coincidencia en `PLAN_EJECUCION_v2.md` (doc histórico, no se toca). |
| `grep -rn ':80\b' .github/ deploy/ terraform/` | sin coincidencias — pipelines no referencian el puerto interno. |

## Gaps a cubrir por el owner localmente (sin docker en el sandbox)

```bash
# Build
docker build -t city2cruise-backend:ci  ./backend
docker build -t city2cruise-frontend:ci ./cruise-connect-main

# Criterios de aceptación H-1.3
docker run --rm --entrypoint id city2cruise-backend:ci  -u   # esperado: 1000 (node)
docker run --rm --entrypoint id city2cruise-frontend:ci -u   # esperado: 101  (nginx)

docker inspect city2cruise-backend:ci  --format '{{.Config.Healthcheck.Test}}'
docker inspect city2cruise-frontend:ci --format '{{.Config.Healthcheck.Test}}'

# E2E
docker compose up -d
sleep 60
curl -fsS http://localhost/api/health   # backend via frontend Nginx
curl -fsS http://localhost/             # SPA index
docker compose ps                        # ambos health == healthy
docker compose down
```

Pegar los outputs en `docs/devops/audits/post-h13/` y firmar el cierre del
hito con un commit `docs(audit): add H-1.3 docker validation evidence`.

## Trazabilidad

- Auditoría: hallazgo `S-03`.
- Hoja de ruta: capítulo 1, hito H-1.3.
- Tag: `hito-H-1.3-completed`.
