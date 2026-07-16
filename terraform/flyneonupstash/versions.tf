terraform {
  required_version = ">= 1.5.0"

  # Backend remoto: Terraform Cloud / Spacelift / S3+DDB.
  # Para MVP usamos backend local; cuando haya 2 entornos activos a la vez,
  # mover a remote (ver README).
  backend "local" {}

  required_providers {
    fly = {
      source  = "fly-apps/fly"
      version = "~> 0.0.23"
    }
    neon = {
      source  = "kislerdm/neon"
      version = "~> 0.6"
    }
    upstash = {
      source  = "upstash/upstash"
      version = "~> 1.5"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.22"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
