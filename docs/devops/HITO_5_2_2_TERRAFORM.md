# Hito 5.2.2 — Infraestructura como Código (Terraform)

> Status: **Done** (2026-04-28)
> Fase: 5 — DevOps & Cloud
> Predecesor: ADR-001 (Hito 5.2.1)
> Sucesor: Hito 5.2.3 — tres entornos aislados

## Objetivo

Toda la infraestructura de City2Cruise descrita en código, validada
en CI, aplicable con un solo comando, reproducible entre `staging` y
`production` y trivialmente migrable entre stacks.

## Entregables

```
terraform/
├── README.md                  ← guía de uso
├── .gitignore                 ← bloquea state y *.tfvars reales
├── flyneonupstash/            ← stack PRIMARIO (ADR-001)
│   ├── versions.tf            ← TF >=1.5, providers fly/neon/upstash/cloudflare
│   ├── providers.tf
│   ├── variables.tf           ← 154 líneas, 18 variables (7 sensitive)
│   ├── locals.tf
│   ├── main.tf                ← 167 líneas — Neon + Upstash + Fly + CF Pages
│   ├── outputs.tf             ← URLs y secrets para CD
│   ├── staging.tfvars.example
│   └── production.tfvars.example
└── aws/                       ← stack ALTERNATIVO escalable
    ├── versions.tf
    ├── variables.tf
    ├── locals.tf
    ├── network.tf             ← VPC + subnets + IGW + 4 SGs
    ├── compute.tf             ← ALB + ECS Fargate + IAM + CloudWatch Logs
    ├── data.tf                ← RDS Postgres + ElastiCache Redis
    ├── cdn.tf                 ← S3 + CloudFront + OAC
    └── outputs.tf
```

## Recursos definidos

### Stack primario (Fly.io + Neon + Upstash + Cloudflare Pages)

| Recurso | Cantidad | Diferencias staging vs prod |
|---|---|---|
| `fly_app.backend` | 1 | — |
| `fly_volume.backend_data` | 1 (1 GB) | — |
| `fly_machine.backend` | `fly_backend_vm_count` | 1 staging, 2 prod |
| `fly_machine.backend_replica` | 0 ó N | sólo en prod, regiones extra |
| `neon_project.main` | 1 | — |
| `neon_branch.env` | 0 ó 1 | sólo no-prod, free tier permite 10 |
| `neon_database.app` + `neon_endpoint.rw` | 1 | — |
| `upstash_redis_database.cache` | 1 | TLS+LRU; multizone auto en pago |
| `cloudflare_pages_project.frontend` | 1 | preview deployments OFF en prod |

### Stack AWS (alternativa escala)

| Recurso | Cantidad |
|---|---|
| VPC + 2 subnets pub + 2 priv + IGW | 1 |
| Security groups (alb, ecs, rds, redis) | 4 |
| ALB + target group + listener | 1 |
| ECS cluster + task def + service Fargate | 1 |
| RDS Postgres 15 (multi-AZ en prod, gp3, encrypted) | 1 |
| ElastiCache Redis 7 (1 nodo staging, 2 prod, failover, encryption) | 1 |
| S3 bucket privado + CloudFront + OAC + bucket policy | 1 |
| CloudWatch Log Group | 1 (retención 7d/30d) |
| IAM role + policy attachment | 1 |

## Decisiones de diseño

1. **Local backend por defecto, remoto documentado.** Para 1 ingeniero
   trabajando en MVP, `local` simplifica. Cuando entren más manos o se
   ejecute desde CI, migrar a Terraform Cloud o S3+DynamoDB
   (instrucciones en `terraform/README.md` y `versions.tf`).
2. **Secretos vía `TF_VAR_*` env vars.** Nunca en `*.tfvars`
   commiteados. `.gitignore` bloquea `*.tfvars` y permite sólo
   `*.tfvars.example` (sin valores reales).
3. **Mismo módulo, distintos `.tfvars` por entorno.** Resuelve Hito
   5.2.3 sin duplicar código. La variable `environment` controla
   diferencias (réplicas, retención, multi-AZ, etc.).
4. **Outputs sensitive marcados.** `database_url`, `redis_url`,
   `redis_rest_token`, `rds_endpoint`, `redis_endpoint` no aparecen en
   logs de CI.
5. **Health check del ALB en `/health`.** Acopla con Hito 5.3.6 — el
   backend ya expone `/health` y debe seguir haciéndolo.
6. **CloudFront con OAC (no OAI).** OAC es la recomendación AWS desde
   2022; OAI sigue funcionando pero está deprecado.

## Validación

```bash
# Stack primario
cd terraform/flyneonupstash
terraform fmt -recursive
terraform init -backend=false
terraform validate
# → Success! The configuration is valid.

# Stack AWS
cd ../aws
terraform fmt -recursive
terraform init -backend=false
terraform validate
# → Success! The configuration is valid.
```

Ambos módulos validan sin warnings ni errores con Terraform 1.9.8.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| State local se pierde si se borra el repo | Migrar a remote backend antes de primer apply real |
| `*.tfvars` con secretos commiteado por error | `.gitignore` + revisar con gitleaks (Hito 5.2.5) |
| Provider `fly-apps/fly` archivado (community) | Plan B: gestionar Fly con `flyctl deploy` y mantener TF para Neon/Upstash/CF únicamente |
| Free tiers Neon/Upstash insuficientes | Outputs separados para que migrar sea cambiar plan, no IaC |

## Próximo hito

**5.2.3** — orquestar los 3 entornos (dev docker-compose, staging y
prod en Fly/Neon/Upstash) con un workflow de CD que use estos módulos
y `.tfvars` por entorno.
