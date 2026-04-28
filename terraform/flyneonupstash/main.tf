# =============================================================================
# Hito 5.2.2 — Infraestructura como Código (Fly.io + Neon + Upstash + CF Pages)
# =============================================================================
# Stack primario decidido en ADR-001 (docs/adr/ADR-001-cloud-provider.md).
# Ver alternativa AWS escalable en terraform/aws/.
# =============================================================================

# ─────────────────────────────────────────────────────────────────────────────
# Neon — Postgres 15 + PostGIS, branching y PITR
# ─────────────────────────────────────────────────────────────────────────────
resource "neon_project" "main" {
  name       = "${local.name_prefix}-pg"
  region_id  = var.neon_region
  pg_version = var.neon_pg_version

  history_retention_seconds = var.neon_history_retention_seconds

  default_endpoint_settings {
    autoscaling_limit_min_cu = 0.25 # free tier
    autoscaling_limit_max_cu = 0.25
    suspend_timeout_seconds  = 300
  }
}

# Una rama por entorno (free tier permite 10 ramas).
# Para staging se crea una rama "staging" derivada de la main; para producción
# se usa la rama por defecto.
resource "neon_branch" "env" {
  count      = var.environment == "production" ? 0 : 1
  project_id = neon_project.main.id
  name       = var.environment
  parent_id  = neon_project.main.default_branch_id
}

resource "neon_database" "app" {
  project_id = neon_project.main.id
  branch_id  = var.environment == "production" ? neon_project.main.default_branch_id : neon_branch.env[0].id
  owner_name = neon_project.main.database_user
  name       = "city2cruise"
}

resource "neon_endpoint" "rw" {
  project_id = neon_project.main.id
  branch_id  = var.environment == "production" ? neon_project.main.default_branch_id : neon_branch.env[0].id
  type       = "read_write"
}

# ─────────────────────────────────────────────────────────────────────────────
# Upstash — Redis serverless con TLS + eviction LRU
# ─────────────────────────────────────────────────────────────────────────────
resource "upstash_redis_database" "cache" {
  database_name = "${local.name_prefix}-redis"
  region        = var.upstash_region
  tls           = var.upstash_tls
  eviction      = var.upstash_eviction
}

# ─────────────────────────────────────────────────────────────────────────────
# Fly.io — Backend Node.js (Express + Socket.io)
# ─────────────────────────────────────────────────────────────────────────────
resource "fly_app" "backend" {
  name = "${local.name_prefix}-backend"
  org  = var.fly_org_slug
}

# Volumen persistente para datos efímeros que no caben en Redis (rate limit
# fallback, pid de cluster, etc.). 1 GB free.
resource "fly_volume" "backend_data" {
  app    = fly_app.backend.name
  name   = "data"
  region = var.fly_region_primary
  size   = 1
}

resource "fly_machine" "backend" {
  count  = var.fly_backend_vm_count
  app    = fly_app.backend.name
  region = var.fly_region_primary
  name   = "${local.name_prefix}-backend-${count.index}"

  image = "ghcr.io/${var.cloudflare_pages_repo_owner}/${lower(var.cloudflare_pages_repo_name)}-backend:latest"

  cputype  = "shared"
  cpus     = 1
  memorymb = 256

  services = [{
    ports = [
      { port = 443, handlers = ["tls", "http"] },
      { port = 80, handlers = ["http"] }
    ]
    protocol      = "tcp"
    internal_port = 9000
  }]

  env = {
    NODE_ENV          = var.environment
    PORT              = "9000"
    DATABASE_URL      = "postgres://${neon_project.main.database_user}:${neon_project.main.database_password}@${neon_endpoint.rw.host}/${neon_database.app.name}?sslmode=require"
    REDIS_URL         = upstash_redis_database.cache.endpoint
    REDIS_TOKEN       = upstash_redis_database.cache.password
    JWT_SECRET        = var.jwt_secret
    AUDIT_HMAC_SECRET = var.audit_hmac_secret
    LOG_LEVEL         = var.environment == "production" ? "info" : "debug"
  }
}

# Réplica de lectura del backend en una segunda región para HA en producción.
resource "fly_machine" "backend_replica" {
  count  = var.environment == "production" ? length(var.fly_region_extra) : 0
  app    = fly_app.backend.name
  region = var.fly_region_extra[count.index]
  name   = "${local.name_prefix}-backend-replica-${count.index}"

  image = "ghcr.io/${var.cloudflare_pages_repo_owner}/${lower(var.cloudflare_pages_repo_name)}-backend:latest"

  cputype  = "shared"
  cpus     = 1
  memorymb = 256

  env = fly_machine.backend[0].env
}

# ─────────────────────────────────────────────────────────────────────────────
# Cloudflare Pages — Frontend SPA estático
# ─────────────────────────────────────────────────────────────────────────────
resource "cloudflare_pages_project" "frontend" {
  account_id        = var.cloudflare_account_id
  name              = "${local.name_prefix}-web"
  production_branch = var.cloudflare_pages_production_branch

  source {
    type = "github"
    config {
      owner                         = var.cloudflare_pages_repo_owner
      repo_name                     = var.cloudflare_pages_repo_name
      production_branch             = var.cloudflare_pages_production_branch
      pr_comments_enabled           = true
      deployments_enabled           = true
      production_deployment_enabled = true
      preview_deployment_setting    = var.environment == "production" ? "none" : "all"
    }
  }

  build_config {
    build_command   = "cd cruise-connect-main && npm ci --legacy-peer-deps && npm run build"
    destination_dir = "cruise-connect-main/dist"
    root_dir        = "/"
  }

  deployment_configs {
    production {
      environment_variables = {
        VITE_API_BASE_URL = "https://${fly_app.backend.name}.fly.dev"
        VITE_ENV          = var.environment
      }
    }

    preview {
      environment_variables = {
        VITE_API_BASE_URL = "https://${fly_app.backend.name}.fly.dev"
        VITE_ENV          = "preview"
      }
    }
  }
}
