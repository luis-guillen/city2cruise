output "alb_dns_name" {
  description = "DNS público del ALB del backend."
  value       = aws_lb.main.dns_name
}

output "rds_endpoint" {
  description = "Endpoint Postgres."
  value       = aws_db_instance.postgres.endpoint
  sensitive   = true
}

output "redis_endpoint" {
  description = "Endpoint Redis primario."
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
  sensitive   = true
}

output "cloudfront_domain" {
  description = "Dominio CloudFront del frontend."
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "frontend_bucket" {
  description = "Bucket S3 del frontend (donde sube el CD)."
  value       = aws_s3_bucket.frontend.bucket
}
