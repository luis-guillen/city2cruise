# Hito 5.2.3 — Tres entornos aislados

> Status: **Done** (2026-04-28)
> Fase: 5 — DevOps & Cloud
> Predecesor: 5.2.2 (Terraform)
> Sucesor: 5.2.4 (Backups + DR)

## Mapa de entornos

| Entorno | Stack | URL backend | URL frontend | DB / Redis | Triggers de deploy |
|---|---|---|---|---|---|
| **dev** | Docker Compose local | http://localhost:9000 | http://localhost:9100 | postgres:15 + redis:7 en contenedores, datos en volumen `pgdata_dev` | manual `make dev-up` |
| **staging** | Fly.io + Neon (rama `staging`) + Upstash | https://city2cruise-staging-backend.fly.dev | https://city2cruise-staging-web.pages.dev | Neon branch `staging` (PITR 1d) + Upstash free | automático en push a `main` y `FASE4-FASE5-FASE6` |
| **production** | Fly.io (HA, 2 VMs + réplica CDG) + Neon (rama default) + Upstash multi-zone | https://city2cruise-production-backend.fly.dev | https://city2cruise.pages.dev | Neon main branch (PITR 7d) + Upstash multi-zone | manual: tag `vX.Y.Z` + aprobación en GitHub Environments |

## Aislamiento garantizado

| Capa | Aislamiento |
|---|---|
| Compute | Apps Fly.io independientes con tokens distintos (`FLY_API_TOKEN_STAGING` vs `FLY_API_TOKEN_PROD`) |
| DB | Proyectos Neon distintos en el módulo TF; mismas credenciales no funcionan |
| Cache | Bases Upstash distintas con tokens distintos |
| Frontend | Proyectos Cloudflare Pages distintos, dominios distintos |
| Secrets | GitHub Encrypted Secrets nombrados con sufijo `_STAGING`/`_PROD` |
| Reviewer gate | Environment `production` configurado con required reviewers en GH |

## Variables de entorno

Cada entorno tiene su propia plantilla en `envs/`:

```
envs/
├── dev.env.example         ← carga con `set -a; source envs/dev.env`
├── staging.env.example     ← inyección vía `flyctl secrets set` y CF Pages env vars
└── production.env.example  ← idem, con valores en LIVE mode
```

Diferencias clave por entorno:

| Variable | dev | staging | production |
|---|---|---|---|
| `NODE_ENV` | development | staging | production |
| `LOG_LEVEL` | debug | debug | info |
| `STRIPE_SECRET_KEY` | dummy | `sk_test_*` | `sk_live_*` |
| `SENTRY_TRACES_SAMPLE_RATE` | 1.0 | 1.0 | 0.1 |
| `JWT_SECRET` | hardcoded "dev_..." | `openssl rand -hex 32` | rotado cada 90 días (Hito 5.2.5) |

El backend (`backend/src/config/env.ts`) **falla al arrancar** en
`production` si faltan `JWT_SECRET`, `REFRESH_TOKEN_SECRET`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` o si
`FIELD_ENCRYPTION_KEY` sigue siendo el valor de desarrollo.

## Orquestación: `Makefile`

Todos los comandos de levantar/parar/desplegar están en el `Makefile`
de la raíz. `make help` lista los disponibles.

```bash
# Dev
make dev-up               # docker compose up -d
make dev-logs
make dev-down

# Staging
make staging-plan         # terraform plan -var-file=staging.tfvars
make staging-apply        # terraform apply
make staging-deploy SHA=abc1234   # flyctl deploy con imagen GHCR
make staging-smoke        # curl /api/health
make staging-logs         # flyctl logs

# Production
make production-plan
make production-apply     # confirmación manual
make production-deploy TAG=v1.2.3   # bluegreen
make production-smoke
make production-rollback  # lista releases para elegir

# Genérico
make tf-validate          # valida ambos módulos TF
```

## Workflows CD (existentes, encajan con esta estructura)

| Workflow | Disparador | Entorno target |
|---|---|---|
| `.github/workflows/cd.yml::deploy-staging` | push a `main` | `staging` (auto) |
| `.github/workflows/cd.yml::deploy-production` | tag `vX.Y.Z` o workflow_dispatch | `production` (gated) |
| `.github/workflows/cd-frontend.yml` | push a `main`/tag | Cloudflare Pages (per-env) |

## Promoción entre entornos

```
feature/* ──merge──▶ FASE4-FASE5-FASE6 ──merge──▶ main ──push──▶ staging (auto)
                                                          │
                                                  ──tag vX.Y.Z──▶ production (manual review)
```

Reglas:
1. **Nunca push directo a `main`.** Solo merges desde rama de feature.
2. **Nunca push directo a producción.** Solo tags semver tras
   green CI + green smoke en staging.
3. **Tag = release.** `release.yml` (Hito 5.1.4) genera el tag desde
   commits Conventional. Manual override sólo para hotfix.

## Recuperación de un entorno

| Escenario | Comando |
|---|---|
| Dev se ensucia / DB rara | `make dev-reset` (borra volúmenes) |
| Staging roto por mal deploy | `make staging-deploy SHA=<sha-anterior>` |
| Producción roto | `make production-rollback` y luego deploy del tag previo |
| DB staging corrupta | Crear nueva rama Neon desde `main` y apuntar `DATABASE_URL` |
| Infra staging entera | `make staging-apply` (terraform reconcilia) |

DR completo en producción: ver Hito 5.2.4.

## Coste mensual estimado por entorno

| Entorno | Compute | DB | Cache | CDN | Total |
|---|---|---|---|---|---|
| dev | $0 (laptop) | $0 | $0 | — | **$0** |
| staging | $0 (Fly free 3 VMs) | $0 (Neon free) | $0 (Upstash free 10k cmds/d) | $0 (CF Pages free) | **$0** |
| production (MVP) | $0 (Fly free) | $0 (Neon free) | $0 (Upstash free) | $0 (CF Pages free) | **$0** |
| production (escala 50k req/d) | ~$30 | ~$19 (Neon Launch) | ~$10 (Upstash PAYG) | $0 | **~$59** |
