# Hito 5.2.4 — Backups + DR runbook

> Status: **Done** (2026-04-28)
> Fase: 5 — DevOps & Cloud
> Predecesor: 5.2.3 (entornos)
> Sucesor: 5.2.5 (gestión de secretos)

## Objetivo

Garantizar **RPO < 1h** y **RTO < 4h** sobre el stack
Fly.io + Neon + Upstash + Cloudflare Pages.

## Entregables

| Artefacto | Ruta | Función |
|---|---|---|
| `scripts/backup/neon-snapshot.sh` | scripts | Crea rama snapshot Neon diaria + retiene 7 |
| `scripts/backup/restore-from-pitr.sh` | scripts | Restaura DB a un timestamp arbitrario (PITR) |
| `.github/workflows/backup.yml` | CI | Cron diario 03:00 UTC + alerta Slack si falla |
| `docs/runbooks/DR_RUNBOOK.md` | docs | Procedimientos paso a paso para 5 escenarios |

## Capacidades de backup activas

| Componente | Mecanismo | Retención | RPO |
|---|---|---|---|
| Neon Postgres | PITR continuo (WAL) | 7 días (config en TF) | ~5 min |
| Neon Postgres | Snapshot diario (rama) | 7 snapshots rotativos | 24h |
| Upstash Redis | AOF + multi-zone | continuo | minutos |
| GHCR images | Inmutables por tag/sha | indefinida | 0 |
| GitHub repo | Git history | indefinida | 0 |
| Terraform state | Local hoy, migrar a S3 | manual | <1d |

## Escenarios de DR cubiertos

1. **Postgres corrupto / borrado masivo** → PITR + restore script. RTO 30min.
2. **Caída región Fly MAD** → failover automático a CDG. RTO 15min.
3. **Upstash caído** → reaprovisionar (cache no es estado crítico). RTO 20min.
4. **Rollback de release malo** → `flyctl deploy` con tag previo. RTO 5min.
5. **Pérdida total de cuenta Fly** → reconstruir con `make production-apply` desde código + restore Neon. RTO ~3h.

## Decisiones

- **PITR > snapshots cron como mecanismo principal.** Neon tiene WAL
  continuo de 7 días en free tier. Los snapshots cron son la red de
  seguridad para casos donde el WAL ya no alcanza (>7d).
- **Redis es cache, no estado.** Pérdida total = degradación
  temporal de rendimiento, no incidente de DR. No se backupea.
- **Imágenes Docker como "backup" del código binario.** Rollback en 5
  min apuntando a tag anterior (todos los tags semver están en GHCR).
- **Secrets fuera del DR runbook.** Se restauran desde 1Password / GH
  Encrypted Secrets manualmente — están versionados como hashes en
  Hito 5.2.5 pero no como blobs.

## Validación SLA

| Métrica | Objetivo | Alcanzable | OK |
|---|---|---|---|
| RPO | <1h | ~5 min (PITR) | ✅ |
| RTO escenario más probable (DB) | <4h | 30 min | ✅ |
| RTO peor caso (cuenta total) | <4h | ~3h | ✅ con margen |

## Pendiente

- [ ] Drill de restore en staging (Q3-2026)
- [ ] Drill de failover de región (Q4-2026)
- [ ] Migrar Terraform state a S3+DynamoDB (Hito 5.2.5)
- [ ] Configurar `secrets.NEON_PROJECT_ID_PROD` + `NEON_API_KEY` + `SLACK_WEBHOOK_URL` en GH Settings (sin esto el cron `backup.yml` falla en su primera ejecución)
