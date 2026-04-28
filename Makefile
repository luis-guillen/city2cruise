# ============================================================================
# City2Cruise — orquestador de los 3 entornos (Hito 5.2.3)
# ============================================================================
# Uso:
#   make help
#   make dev-up
#   make dev-down
#   make staging-deploy
#   make production-deploy   (requiere tag vX.Y.Z y aprobación manual en GH)
# ============================================================================

SHELL := /bin/bash

.DEFAULT_GOAL := help

# ─── DEV (docker-compose) ─────────────────────────────────────────────────
.PHONY: dev-up
dev-up: ## Levanta dev local (db + redis + backend + frontend)
	@echo ">> Levantando entorno dev..."
	@test -f .env || (echo "Crea .env desde envs/dev.env.example primero"; exit 1)
	docker compose -f docker-compose.dev.yml up -d --build
	@echo "   backend  → http://localhost:9000/api/health"
	@echo "   frontend → http://localhost:9100"

.PHONY: dev-down
dev-down: ## Para dev local
	docker compose -f docker-compose.dev.yml down

.PHONY: dev-logs
dev-logs: ## Sigue logs de dev local
	docker compose -f docker-compose.dev.yml logs -f --tail=100

.PHONY: dev-reset
dev-reset: ## Borra volúmenes y reinicia dev local (¡pierde datos!)
	docker compose -f docker-compose.dev.yml down -v
	$(MAKE) dev-up

# ─── STAGING (Fly.io + Neon + Upstash) ────────────────────────────────────
.PHONY: staging-plan
staging-plan: ## Terraform plan staging
	cd terraform/flyneonupstash && terraform plan -var-file=staging.tfvars

.PHONY: staging-apply
staging-apply: ## Terraform apply staging
	cd terraform/flyneonupstash && terraform apply -var-file=staging.tfvars

.PHONY: staging-deploy
staging-deploy: ## Deploy backend a staging Fly.io (usa imagen ya en GHCR)
	@test -n "$(SHA)" || (echo "Pasa SHA=<commit-sha>"; exit 1)
	flyctl deploy --remote-only \
		--app city2cruise-staging-backend \
		--image ghcr.io/pablete64/city2cruise-backend:sha-$(SHA) \
		--strategy rolling

.PHONY: staging-smoke
staging-smoke: ## Smoke test staging
	@curl -fsS https://city2cruise-staging-backend.fly.dev/api/health | jq .

.PHONY: staging-logs
staging-logs: ## Sigue logs de staging
	flyctl logs --app city2cruise-staging-backend

# ─── PRODUCTION (Fly.io + Neon + Upstash) ─────────────────────────────────
.PHONY: production-plan
production-plan: ## Terraform plan production
	cd terraform/flyneonupstash && terraform plan -var-file=production.tfvars

.PHONY: production-apply
production-apply: ## Terraform apply production (CONFIRMACIÓN MANUAL)
	cd terraform/flyneonupstash && terraform apply -var-file=production.tfvars

.PHONY: production-deploy
production-deploy: ## Deploy backend a producción Fly.io (bluegreen)
	@test -n "$(TAG)" || (echo "Pasa TAG=v1.2.3"; exit 1)
	flyctl deploy --remote-only \
		--app city2cruise-production-backend \
		--image ghcr.io/pablete64/city2cruise-backend:$(TAG) \
		--strategy bluegreen \
		--wait-timeout 600

.PHONY: production-smoke
production-smoke: ## Smoke test producción
	@curl -fsS https://city2cruise-production-backend.fly.dev/api/health | jq .

.PHONY: production-rollback
production-rollback: ## Rollback al release anterior en Fly.io
	flyctl releases --app city2cruise-production-backend
	@echo "Para revertir: flyctl deploy --image <release-anterior>"

# ─── Genérico ────────────────────────────────────────────────────────────
.PHONY: tf-validate
tf-validate: ## Valida ambos módulos Terraform
	cd terraform/flyneonupstash && terraform fmt -check -recursive && terraform init -backend=false && terraform validate
	cd terraform/aws && terraform fmt -check -recursive && terraform init -backend=false && terraform validate

.PHONY: help
help: ## Muestra esta ayuda
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'
