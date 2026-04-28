# ─────────────────────────────────────────────────────────────────────────────
# RDS Postgres + ElastiCache Redis
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_db_subnet_group" "rds" {
  name       = "${local.name_prefix}-rds-sng"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "postgres" {
  identifier              = "${local.name_prefix}-pg"
  engine                  = "postgres"
  engine_version          = "15.7"
  instance_class          = var.rds_instance_class
  allocated_storage       = var.rds_storage_gb
  storage_type            = "gp3"
  storage_encrypted       = true
  db_name                 = "city2cruise"
  username                = "city2cruise"
  password                = var.rds_password
  vpc_security_group_ids  = [aws_security_group.rds.id]
  db_subnet_group_name    = aws_db_subnet_group.rds.name
  publicly_accessible     = false
  multi_az                = var.environment == "production" ? true : false
  backup_retention_period = var.environment == "production" ? 7 : 1
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:30-sun:05:30"
  skip_final_snapshot     = var.environment == "staging"
  deletion_protection     = var.environment == "production"
  apply_immediately       = var.environment == "staging"
}

resource "aws_elasticache_subnet_group" "redis" {
  name       = "${local.name_prefix}-redis-sng"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "${local.name_prefix}-redis"
  description                = "${local.name_prefix} cache + sessions + rate-limit"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.redis_node_type
  num_cache_clusters         = var.environment == "production" ? 2 : 1
  parameter_group_name       = "default.redis7"
  port                       = 6379
  security_group_ids         = [aws_security_group.redis.id]
  subnet_group_name          = aws_elasticache_subnet_group.redis.name
  automatic_failover_enabled = var.environment == "production"
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
}
