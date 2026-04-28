# ─────────────────────────────────────────────────────────────────────────────
# Outputs (sensitive enmascarados, todos los valores que el equipo necesita
# tras un `terraform apply` para configurar GitHub Secrets, .env y CI).
# ─────────────────────────────────────────────────────────────────────────────

output "backend_url" {
  description = "URL pública del backend Fly.io."
  value       = "https://${fly_app.backend.name}.fly.dev"
}

output "frontend_url" {
  description = "URL pública del frontend (Cloudflare Pages)."
  value       = "https://${cloudflare_pages_project.frontend.name}.pages.dev"
}

output "neon_project_id" {
  description = "ID del proyecto Neon."
  value       = neon_project.main.id
}

output "database_url" {
  description = "Connection string de Postgres."
  value       = "postgres://${neon_project.main.database_user}:${neon_project.main.database_password}@${neon_endpoint.rw.host}/${neon_database.app.name}?sslmode=require"
  sensitive   = true
}

output "redis_url" {
  description = "URL del Redis Upstash (rediss://)."
  value       = upstash_redis_database.cache.endpoint
  sensitive   = true
}

output "redis_rest_token" {
  description = "Token REST de Upstash."
  value       = upstash_redis_database.cache.rest_token
  sensitive   = true
}

output "fly_app_name" {
  description = "Nombre de la Fly app del backend."
  value       = fly_app.backend.name
}

output "environment" {
  description = "Entorno desplegado."
  value       = var.environment
}
