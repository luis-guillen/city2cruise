variable "environment" {
  description = "staging | production"
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment debe ser 'staging' o 'production'."
  }
}

variable "project_name" {
  description = "Slug del proyecto (prefijo de recursos)."
  type        = string
  default     = "city2cruise"
}

variable "aws_region" {
  description = "Región AWS (eu-south-2 = Spain, eu-west-1 = Ireland)."
  type        = string
  default     = "eu-south-2"
}

variable "vpc_cidr" {
  description = "CIDR de la VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "azs" {
  description = "Zonas de disponibilidad a usar."
  type        = list(string)
  default     = ["eu-south-2a", "eu-south-2b"]
}

variable "rds_instance_class" {
  description = "Tamaño de la instancia RDS Postgres."
  type        = string
  default     = "db.t4g.micro"
}

variable "rds_storage_gb" {
  description = "Almacenamiento RDS gp3 en GB."
  type        = number
  default     = 20
}

variable "rds_password" {
  description = "Contraseña master de RDS."
  type        = string
  sensitive   = true
}

variable "fargate_cpu" {
  description = "CPU del task Fargate (256 = 0.25 vCPU)."
  type        = number
  default     = 256
}

variable "fargate_memory" {
  description = "Memoria del task Fargate (MB)."
  type        = number
  default     = 512
}

variable "fargate_desired_count" {
  description = "Número de tasks Fargate."
  type        = number
  default     = 2
}

variable "container_image" {
  description = "Imagen Docker del backend (ECR o GHCR)."
  type        = string
}

variable "redis_node_type" {
  description = "Tipo de nodo ElastiCache Redis."
  type        = string
  default     = "cache.t4g.micro"
}
