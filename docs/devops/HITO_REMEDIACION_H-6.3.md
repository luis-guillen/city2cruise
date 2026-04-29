# Hito H-6.3 — Diagrama de arquitectura actualizado

**Severidad:** INFO
**Owner:** Cualquiera
**Esfuerzo:** ~1 hora
**Estado:** ✅ Cerrado

## Cambio

`docs/architecture.mmd` (nuevo, 79 líneas) — diagrama Mermaid `flowchart
LR` con la arquitectura **actual** post-remediación. Componentes:

### Plano de aplicación

- Usuario web/móvil + Service Worker (web-push, offline cache).
- Cloudflare Pages (CDN para la SPA estática).
- React 18 + Vite 6 + Tailwind + shadcn/ui.
- Nginx 8080 (`nginx-unprivileged`, no-root, CSP/HSTS/CORS — H-1.3, H-1.4).
- Express + Socket.IO sobre Node 20 alpine no-root (H-1.3).
- `rl_service` (FastAPI + RLlib) — matching avanzado.
- `digital_twin` (FastAPI) — simulación operacional.

### Plano de datos

- PostgreSQL 15 + PostGIS en Neon.
- Redis 7 en Upstash (cache + pub/sub Socket.IO).

### Plano de observabilidad

- Sentry (APM + errors).
- Prometheus + Grafana (métricas + alerting).

### Servicios externos

- Stripe (pagos + webhooks).
- Twilio (SMS handshake).
- Web Push (VAPID + service worker).

### CI/CD (subgraph)

`build-push GHCR` → `security-scan` (SBOM CycloneDX + Trivy) +
`cosign keyless OIDC` → `deploy → Fly.io staging + prod`.

## Renderizado

```bash
# PNG (requiere npx + chromium)
npx @mermaid-js/mermaid-cli -i docs/architecture.mmd -o docs/architecture.png

# SVG
npx @mermaid-js/mermaid-cli -i docs/architecture.mmd -o docs/architecture.svg
```

GitHub renderiza Mermaid nativamente al ver el `.mmd` desde la UI o al
embeberlo con triple-backtick `mermaid`.

## Trazabilidad

- Hoja de ruta: capítulo 6, hito H-6.3.
- Tag: `hito-H-6.3-completed`.
