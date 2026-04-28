# ─────────────────────────────────────────────────────────────────────────────
# Variables
# ─────────────────────────────────────────────────────────────────────────────

variable "environment" {
  description = "Nombre del entorno (staging | production)."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment debe ser 'staging' o 'production'."
  }
}

variable "project_name" {
  description = "Slug del proyecto, usado como prefijo de recursos."
  type        = string
  default     = "city2cruise"
}

# ─── Fly.io ────────────────────────────────────────────────────────────────
variable "fly_org_slug" {
  description = "Slug de la organización Fly.io."
  type        = string
}

variable "fly_region_primary" {
  description = "Región principal de Fly.io (3 letras, ver `fly platform regions`)."
  type        = string
  default     = "mad" # Madrid
}

variable "fly_region_extra" {
  description = "Regiones adicionales para HA (lista de códigos de 3 letras)."
  type        = list(string)
  default     = ["cdg"] # Paris, fallback
}

variable "fly_backend_vm_size" {
  description = "Tamaño VM para el backend (shared-cpu-1x = free, performance-1x = pago)."
  type        = string
  default     = "shared-cpu-1x"
}

variable "fly_backend_vm_count" {
  description = "Número de VMs del backend."
  type        = number
  default     = 1
}

# ─── Neon (Postgres + PostGIS) ────────────────────────────────────────────
variable "neon_region" {
  description = "Región Neon. Ver https://neon.tech/docs/introduction/regions."
  type        = string
  default     = "aws-eu-west-1" # Irlanda, sin Madrid pero baja latencia con MAD
}

variable "neon_pg_version" {
  description = "Versión de PostgreSQL en Neon (15, 16)."
  type        = number
  default     = 15
}

variable "neon_history_retention_seconds" {
  description = "Retención del historial PITR en segundos. Free tier máximo 7 días."
  type        = number
  default     = 604800 # 7 días
}

# ─── Upstash (Redis) ─────────────────────────────────────────────────────
variable "upstash_region" {
  description = "Región Upstash más cercana (eu-west-1 = Irlanda)."
  type        = string
  default     = "eu-west-1"
}

variable "upstash_eviction" {
  description = "Habilitar eviction LRU cuando se llene la memoria."
  type        = bool
  default     = true
}

variable "upstash_tls" {
  description = "Forzar TLS en las conexiones Redis."
  type        = bool
  default     = true
}

# ─── Cloudflare Pages (frontend) ─────────────────────────────────────────
variable "cloudflare_account_id" {
  description = "Account ID de Cloudflare (Account → API → Account ID)."
  type        = string
}

variable "cloudflare_pages_repo_owner" {
  description = "Owner del repo en GitHub para builds de Pages."
  type        = string
  default     = "pablete64"
}

variable "cloudflare_pages_repo_name" {
  description = "Nombre del repo en GitHub para builds de Pages."
  type        = string
  default     = "APP_TRASNPORTE_LOCKERS_BARCELONA"
}

variable "cloudflare_pages_production_branch" {
  description = "Rama que dispara despliegue a producción de Pages."
  type        = string
  default     = "main"
}

# ─── Secretos sensibles inyectados desde GitHub Actions / .tfvars cifrado ──
variable "fly_api_token" {
  description = "Token de Fly.io (env FLY_API_TOKEN). Sensitive."
  type        = string
  sensitive   = true
}

variable "neon_api_key" {
  description = "API key de Neon (env NEON_API_KEY). Sensitive."
  type        = string
  sensitive   = true
}

variable "upstash_email" {
  description = "Email de la cuenta Upstash. Sensitive."
  type        = string
  sensitive   = true
}

variable "upstash_api_key" {
  description = "API key de Upstash. Sensitive."
  type        = string
  sensitive   = true
}

variable "cloudflare_api_token" {
  description = "API token de Cloudflare (perm: Pages Edit). Sensitive."
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "Secreto JWT (>=64 chars). Sensitive."
  type        = string
  sensitive   = true
}

variable "audit_hmac_secret" {
  description = "Secreto HMAC para audit log. Sensitive."
  type        = string
  sensitive   = true
}
