# Infraestructura como Código — City2Cruise

Hito **5.2.2** del HOJA_DE_RUTA. Define toda la infra de City2Cruise en
Terraform, validada y reproducible.

```
terraform/
├── flyneonupstash/   # Stack PRIMARIO (ADR-001) — $0 en MVP
└── aws/              # Stack ALTERNATIVO escalable — para >50k req/día
```

## Stack primario: Fly.io + Neon + Upstash + Cloudflare Pages

Recursos creados (`terraform/flyneonupstash/`):

| Capa | Recurso TF | Notas |
|---|---|---|
| Backend | `fly_app.backend` + `fly_machine.backend[*]` | shared-cpu-1x, 256 MB |
| Volumen | `fly_volume.backend_data` | 1 GB persistente (free) |
| HA prod | `fly_machine.backend_replica[*]` | sólo en `production`, regiones extra |
| Postgres | `neon_project.main` + `neon_endpoint.rw` | 15 + PostGIS, autoscale 0.25 CU |
| Branching | `neon_branch.env[*]` | una rama por entorno (no en prod) |
| Redis | `upstash_redis_database.cache` | TLS + LRU eviction |
| Frontend | `cloudflare_pages_project.frontend` | build automático desde GitHub |

### Uso

```bash
cd terraform/flyneonupstash
cp staging.tfvars.example staging.tfvars   # rellenar con tus IDs no sensibles
terraform init
terraform plan -var-file=staging.tfvars
terraform apply -var-file=staging.tfvars
```

Los **secretos sensibles** se inyectan vía variables de entorno
`TF_VAR_*` (jamás en disco):

```bash
export TF_VAR_fly_api_token=$(flyctl auth token)
export TF_VAR_neon_api_key=$NEON_API_KEY
export TF_VAR_upstash_email=$UPSTASH_EMAIL
export TF_VAR_upstash_api_key=$UPSTASH_API_KEY
export TF_VAR_cloudflare_api_token=$CLOUDFLARE_API_TOKEN
export TF_VAR_jwt_secret=$(openssl rand -hex 32)
export TF_VAR_audit_hmac_secret=$(openssl rand -hex 32)
```

En CI los mismos valores se leen desde `secrets.*` de GitHub Actions
(ver `.github/workflows/cd.yml`).

### Outputs útiles tras `apply`

| Output | Para qué |
|---|---|
| `backend_url` | Setear como `VITE_API_BASE_URL` en frontend |
| `database_url` (sensitive) | Setear como `DATABASE_URL` en Fly secrets |
| `redis_url` (sensitive) | Setear como `REDIS_URL` en Fly secrets |
| `frontend_url` | Compartir con el equipo / DNS |

## Stack alternativo: AWS (ECS Fargate + RDS + ElastiCache + CloudFront)

Recursos creados (`terraform/aws/`):

| Capa | Recurso TF |
|---|---|
| Red | VPC + 2 subnets pub + 2 priv + IGW + SGs |
| Balanceo | ALB + target group + listener HTTP |
| Compute | ECS cluster + task definition + service Fargate |
| Postgres | RDS Postgres 15 multi-AZ (en prod) + backups 7d |
| Redis | ElastiCache Redis 7 con encryption at-rest + transit |
| CDN/SPA | S3 privado + CloudFront + OAC |
| Logs | CloudWatch Logs (retención 7/30 días) |

### Uso

```bash
cd terraform/aws
terraform init
terraform plan \
  -var environment=staging \
  -var rds_password=$RDS_PASSWORD \
  -var container_image=ghcr.io/pablete64/app_trasnporte_lockers_barcelona-backend:latest
```

## State management

| Stack | Backend | Cuándo migrar a remote |
|---|---|---|
| flyneonupstash | `local` (default) | Cuando 2+ ingenieros toquen infra |
| aws | `local` (commented `s3` block listo) | Antes del primer apply en producción |

Para activar S3+DynamoDB en `aws/`, descomentar el bloque `backend "s3"`
en `versions.tf` y crear primero el bucket `city2cruise-tf-state` y la
tabla `city2cruise-tf-lock` (script `scripts/bootstrap-tf-state.sh` —
pendiente).

## Validación (CI)

El job `terraform-validate` en `.github/workflows/ci.yml` ejecuta
`terraform fmt -check` y `terraform validate` en ambos módulos. Activar
en Hito 5.2.3.

## Tres entornos (Hito 5.2.3)

- **dev** → docker-compose local (sin TF).
- **staging** → `terraform/flyneonupstash/` con `staging.tfvars`.
- **production** → `terraform/flyneonupstash/` con `production.tfvars`.

Mismo módulo, distintos `.tfvars`. Variable `environment` controla:
- réplicas de backend (1 staging, 2 prod + 1 réplica regional)
- retención PITR Neon (1d staging, 7d prod)
- multi-AZ en RDS si se usa AWS
- backups en RDS (1d staging, 7d prod)
- logs retention (7d/30d)
