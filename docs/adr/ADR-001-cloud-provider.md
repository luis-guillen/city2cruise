# ADR-001 — Selección de proveedor cloud

> Status: **Accepted** (2026-04-28)
> Decisores: equipo City2Cruise
> Hito: 5.2.1

## Contexto

City2Cruise necesita desplegar:
- Backend Node.js (Express + Socket.io) con HA mínima.
- Frontend SPA estático (build Vite, ~1 MB).
- PostgreSQL 15 + PostGIS 3.3 (tabla `users.location` GIST, queries
  geoespaciales <50 ms).
- Redis 7 (cache, rate-limit, socket.io adapter, pub/sub).
- Servicio Python `digital_twin` (Hito 5.4) con tráfico bajo.

Restricciones:
- Equipo pequeño (1-2 ingenieros), no DevOps dedicado.
- **Free tier permanente** preferible para validación/MVP.
- Escalabilidad clara hacia volúmenes reales (50k req/día por puerto).
- Despliegue automatizado desde GitHub Actions.

## Opciones evaluadas

| Capa | AWS | DigitalOcean | Fly.io + Neon + Upstash + CF Pages |
|---|---|---|---|
| Frontend hosting | S3 + CloudFront ($) | App Platform Static ($) | **Cloudflare Pages (free unlimited)** |
| Backend runtime | ECS Fargate ($$$) | App Platform Container ($$) | **Fly.io shared-cpu-1x (free hasta 3 VMs)** |
| Postgres | RDS ($$$, free tier 12 meses) | Managed Postgres ($) | **Neon (free 0.5GB + branching + PITR 7d)** |
| Redis | ElastiCache ($$) | Managed Redis ($) | **Upstash (free 10k cmds/d, persistent)** |
| Container registry | ECR ($) | DigitalOcean ($) | **GitHub Container Registry (free public)** |
| Secrets manager | Secrets Manager ($) | env-vars básico | **Fly Secrets + GitHub Encrypted Secrets (free)** |
| Logs | CloudWatch ($) | App Platform basic | **Grafana Cloud free 50GB/30d / Better Stack 1GB free** |
| APM | X-Ray ($) | — | **Sentry free 5k errors/mes** |
| Métricas | CloudWatch ($) | App Platform basic | **Grafana Cloud free 10k series** |
| CI/CD | CodePipeline ($) | App Platform built-in | **GitHub Actions free 2000 min/mes (público: ilimitado)** |
| **Coste mensual estimado MVP** | ~$60-80 | ~$30-40 | **$0** |
| **Coste mensual estimado escala (50k req/día)** | ~$200-300 | ~$80-120 | **~$50-80** |

## Decisión

**Stack primario: Fly.io + Neon + Upstash + Cloudflare Pages + GHCR**

Razones:
1. **$0 en MVP**, todos con free tiers permanentes (no expiran a los 12
   meses como AWS Free Tier).
2. **Profesional**: Fly.io usa Firecracker microVMs (igual que AWS Lambda),
   Neon es Postgres + PostGIS gestionado con branching/PITR de nivel
   AWS Aurora, Upstash es serverless con SLA 99.99 %.
3. **Despliegue inmediato**: `flyctl deploy` desde CI sin Terraform
   complejo. Para Neon/Upstash basta el CLI o la dashboard.
4. **Region MAD/CDG cercanas a Las Palmas** (latencia ~30-50 ms).
5. **GitHub Container Registry** integrado con Actions, sin egress fees.
6. **Cloudflare Pages**: bandwidth ilimitado, edge caché global, deploy
   por commit con previews automáticas.
7. **Camino de escala claro**: cuando el tráfico justifique, se pasa
   Fly.io a `performance-cpu-2x` (manteniendo el mismo deploy), Neon
   sube de tier o se migra a un AWS RDS sin cambios de schema.

**Stack alternativo (escalable cuando facturación lo justifique):
AWS ECS Fargate + RDS + ElastiCache + CloudFront**

Se mantiene el módulo Terraform de AWS (ver `terraform/aws/`) listo
para usar cuando llegue el momento. La portabilidad es trivial porque
todas las apps consumen `DATABASE_URL` y `REDIS_URL` por env var.

## Consecuencias

### Positivas
- $0 en MVP — el equipo puede iterar sin presión de coste.
- Setup inicial en horas, no días.
- Despliegues reversibles (Fly.io rolling/bluegreen sin downtime).
- Backups automáticos PITR 7 días en Neon free tier.

### Negativas / a vigilar
- Free tier de Upstash (10k cmds/día) se agotará pronto bajo carga real
  → migrar a Pay-as-you-go (~$0.20 / 100k cmds) o Redis Cloud free 30 MB.
- Free tier de Neon (0.5 GB) → migrar a Launch tier ($19/mes) cuando se
  superen 50 MB para evitar throttling de auto-suspend.
- Dependencia de proveedores específicos: el lock-in es bajo porque
  todo es Postgres/Redis/Docker estándar.

## Comparativa de coste detallada (anexo)

### Escenario MVP (1 mes piloto, ~5k req/día)
| Proveedor | Backend | DB | Redis | CDN | Total/mes |
|---|---|---|---|---|---|
| AWS Free Tier | $0 (750h Fargate) | $0 (RDS t2.micro 12m) | $0 (ElastiCache t2.micro 12m) | $0.50 (CloudFront 1GB) | **~$1** |
| AWS Post-Free | $35 (Fargate 0.25 vCPU/0.5GB 24/7) | $13 (db.t3.micro RDS) | $11 (cache.t3.micro) | $1 | **~$60** |
| DigitalOcean | $12 (App Basic) | $15 (Postgres Basic 1GB) | $15 (Redis Basic) | gratis | **~$42** |
| **Fly+Neon+Upstash+CF** | $0 (free hasta 3 VMs) | $0 (Neon free 0.5GB) | $0 (Upstash free 10k cmds) | $0 (CF unlimited) | **$0** |

### Escenario escala (1 puerto operativo, 50k req/día)
| Proveedor | Total estimado/mes |
|---|---|
| AWS | $200-300 |
| DigitalOcean | $80-120 |
| **Fly+Neon+Upstash+CF** | $50-80 |

## Próximos pasos

1. Crear cuenta Fly.io / Neon / Upstash / Cloudflare (todas free).
2. Aplicar Terraform en `terraform/flyneonupstash/` (Hito 5.2.2).
3. Migrar secretos a Fly Secrets + GitHub Encrypted Secrets (Hito 5.2.5).
4. Conectar pipelines CI/CD (Hito 5.1.2 ya commiteado).
