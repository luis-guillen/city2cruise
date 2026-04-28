# Hito 5.2.5 — Gestión de secretos + audit del repo

> Status: **Done** (2026-04-28)
> Fase: 5 — DevOps & Cloud
> Predecesor: 5.2.4 (Backups + DR)
> Sucesor: 5.3.x (observabilidad)

## Modelo de gestión de secretos

| Secreto | Almacén primario | Cómo lo lee la app | Quién puede ver |
|---|---|---|---|
| `JWT_SECRET` (prod) | Fly Secrets `city2cruise-production-backend` | `process.env.JWT_SECRET` | Owner Fly org |
| `JWT_SECRET` (staging) | Fly Secrets `city2cruise-staging-backend` | idem | Owner Fly org |
| `REFRESH_TOKEN_SECRET` | Fly Secrets | env | Owner |
| `AUDIT_HMAC_SECRET` | Fly Secrets | env | Owner |
| `FIELD_ENCRYPTION_KEY` | Fly Secrets | env | Owner |
| `DATABASE_URL` | Fly Secrets (output `terraform output -raw database_url`) | env | Owner |
| `REDIS_URL` + `REDIS_TOKEN` | Fly Secrets | env | Owner |
| `STRIPE_SECRET_KEY` (live) | Fly Secrets prod app | env | Owner + Stripe admin |
| `STRIPE_WEBHOOK_SECRET` | Fly Secrets | env | Owner |
| `SENTRY_DSN` | Fly Secrets + CF Pages env | env / build-time | Owner |
| Tokens de proveedores (Fly API, Neon, Upstash, CF) | GitHub Encrypted Secrets | sólo en CD jobs | Repo admin |
| `GHCR_PAT` | GH Secret `GITHUB_TOKEN` (auto) | sólo en CI | — |
| Ninguno en código fuente | git audit (script + gitleaks) | — | nadie |

## Repositorio: regla cero

> **Ningún secreto vive en el repo. Nunca.**

Mecanismos de defensa:

1. **`.gitignore` raíz + `terraform/.gitignore`** bloquean `.env`,
   `envs/*.env`, `*.tfvars`, `*.tfstate`.
2. **`scripts/secrets-audit.sh`** — escaneo regex local de 13
   patrones (AWS, Stripe, GH PAT, Slack, JWT, RSA, Google, Fly,
   DB URLs no-locales). Devuelve 1 si encuentra algo.
3. **Pre-commit hook** (`scripts/pre-commit-secrets.sh`,
   instalable con `scripts/install-hooks.sh`).
4. **CI gitleaks job** (ya en `.github/workflows/ci.yml::security`)
   — falla la build si entra un secreto.
5. **Branch protection main** (Hito 5.1.3) — ni siquiera el owner
   puede pushear directo.

## Inyección de secretos

### Stack primario (Fly + Neon + Upstash)

```bash
# 1. Recoger secretos generados por terraform
cd terraform/flyneonupstash
terraform output -raw database_url       # sensitive
terraform output -raw redis_url
terraform output -raw redis_rest_token

# 2. Inyectar en la app de Fly (prod)
flyctl secrets set --app city2cruise-production-backend \
  DATABASE_URL="$(terraform output -raw database_url)" \
  REDIS_URL="$(terraform output -raw redis_url)" \
  REDIS_TOKEN="$(terraform output -raw redis_rest_token)" \
  JWT_SECRET="$(openssl rand -hex 32)" \
  REFRESH_TOKEN_SECRET="$(openssl rand -hex 32)" \
  AUDIT_HMAC_SECRET="$(openssl rand -hex 32)" \
  FIELD_ENCRYPTION_KEY="$(openssl rand -hex 16)" \
  STRIPE_SECRET_KEY="sk_live_..." \
  STRIPE_WEBHOOK_SECRET="whsec_..." \
  SENTRY_DSN="https://...@sentry.io/..."

# 3. Verificar (no muestra valores, sólo nombres)
flyctl secrets list --app city2cruise-production-backend
```

Fly **redespliega automáticamente** cuando `secrets set` cambia el set,
así que el cambio se aplica sin downtime (rolling).

### CI/CD secrets en GitHub

Necesarios en **Repo Settings → Secrets and variables → Actions**:

| Nombre | Para qué |
|---|---|
| `FLY_API_TOKEN_STAGING` | Deploy CD a Fly staging |
| `FLY_API_TOKEN_PROD` | Deploy CD a Fly prod |
| `NEON_API_KEY` | Backup workflow (snapshots) |
| `NEON_PROJECT_ID_PROD` | Backup workflow |
| `SLACK_WEBHOOK_URL` | Notificaciones de incidentes/backups |
| `CLOUDFLARE_API_TOKEN` | Deploy frontend a Pages |
| `CLOUDFLARE_ACCOUNT_ID` | idem |

Estos se leen **sólo** dentro de jobs autorizados con `permissions:`
mínimos. Nunca se imprimen.

## Política de rotación

| Secreto | Cadencia | Responsable | Procedimiento |
|---|---|---|---|
| `JWT_SECRET` (prod) | 90 días | tech lead | regenerar + `flyctl secrets set` (los tokens vivos invalidan) |
| `REFRESH_TOKEN_SECRET` | 90 días | tech lead | igual; fuerza re-login de todos |
| `FIELD_ENCRYPTION_KEY` | **NUNCA sin migración** | tech lead | requiere re-cifrar columnas — runbook aparte |
| `STRIPE_SECRET_KEY` | sólo si compromiso | Stripe admin | rotate desde dashboard, copiar a Fly Secrets |
| `FLY_API_TOKEN_*` | 180 días | tech lead | `flyctl auth token` nuevo + GH Secret update |
| `NEON_API_KEY` | 180 días | tech lead | dashboard Neon + GH Secret |
| `CLOUDFLARE_API_TOKEN` | 180 días | tech lead | dashboard CF + GH Secret |

Recordatorio automático: pendiente añadir issue plantilla cron
(`.github/workflows/secrets-rotation-reminder.yml`).

## Auditoría del repo (resultado actual)

```bash
$ ./scripts/secrets-audit.sh
==> Escaneando secretos hardcodeados...
✅ Sin hallazgos.
```

Ejecutado tras el commit `d55955e`. **El repo está limpio**.

Patrones cubiertos por el script:
- AWS access keys (`AKIA...`)
- AWS secret keys
- Stripe live (`sk_live_...`) y test (`sk_test_...`)
- GitHub PAT clásico (`ghp_...`) y fine-grained (`github_pat_...`)
- GitHub server tokens (`ghs_...`)
- Slack tokens (`xox[bapsr]-...`)
- Private keys (`-----BEGIN ... PRIVATE KEY-----`)
- Google API keys (`AIza...`)
- Fly.io tokens (`fly_...`)
- JWT largos (`eyJ...{100+ chars}`)
- Connection strings Postgres con credenciales y host no-local

## Defensa en profundidad

```
Dev ──pre-commit hook──▶ no entra al index
   ──CI gitleaks job──▶ no llega a main
   ──branch protection──▶ no llega a producción
   ──Fly Secrets──▶ no se ven en logs ni en stack traces
   ──rotación periódica──▶ aunque se filtren, expiran
```

## Pendiente (mejoras opcionales)

- [ ] Activar GitHub **Secret scanning push protection** en repo
      Settings → Code security (impide el push antes incluso del PR).
- [ ] Migrar a **HashiCorp Vault** o **AWS Secrets Manager** cuando
      haya >1 ingeniero (audit log centralizado, RBAC granular).
- [ ] Issue auto generado cada 90 días para rotar `JWT_SECRET`.
