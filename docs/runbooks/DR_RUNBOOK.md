# Runbook de Disaster Recovery — City2Cruise

> Hito 5.2.4 · Última revisión: 2026-04-28
> Audiencia: on-call engineer
> SLA objetivo: **RPO < 1h · RTO < 4h**

## Definiciones

- **RPO** (Recovery Point Objective): pérdida máxima tolerable de datos.
  Objetivo: **< 1 hora**.
- **RTO** (Recovery Time Objective): tiempo máximo desde el incidente
  hasta restablecer servicio. Objetivo: **< 4 horas**.

## Capacidades de backup

| Componente | Mecanismo | Frecuencia | Retención | RPO efectivo |
|---|---|---|---|---|
| Postgres (Neon prod) | PITR continuo (WAL) | continuo | 7 días | ~5 minutos |
| Postgres (Neon prod) | Snapshot adicional (rama) | diario 03:00 UTC | 7 snapshots | 24 horas |
| Redis (Upstash) | AOF persistencia + multi-zone replication | continuo | — | ~minutos |
| Imágenes Docker (GHCR) | Cada build/tag/sha | cada CD | indefinida | 0 |
| Código (GitHub) | git history | continuo | indefinida | 0 |
| Terraform state | local + (futuro) S3 | en cada apply | indefinida | <1 día |
| Secretos | Fly secrets + GH Encrypted Secrets | manual | indefinida | — |

## Escenarios de DR

### 1. Postgres corrupto / borrado masivo accidental

**Síntomas:** errores 500 generalizados, queries que devuelven 0 filas
en tablas con datos esperados, exceptions de FK.

**Decisión RPO:** ¿cuándo ocurrió la corrupción?
- Si <7 días → usar PITR (RPO ~5 min)
- Si >7 días → usar snapshot diario más cercano (RPO 24h)

**Procedimiento (RTO objetivo: 30 min):**

```bash
# 1. Cortar tráfico a la app (modo mantenimiento)
flyctl scale count 0 --app city2cruise-production-backend
flyctl status --app city2cruise-production-backend  # confirmar 0 machines

# 2. Identificar timestamp seguro (ANTES del incidente)
#    Ej: incidente detectado 14:30, queremos restaurar a 14:00
TIMESTAMP="2026-04-28T14:00:00Z"

# 3. Crear rama Neon a ese punto
export NEON_API_KEY=...
export NEON_PROJECT_ID=...
./scripts/backup/restore-from-pitr.sh "$TIMESTAMP"
# → output: connection string nueva

# 4. Validar la rama restaurada
psql "<connection-string-nueva>" -c "SELECT count(*) FROM users;"
psql "<connection-string-nueva>" -c "SELECT count(*) FROM pickup_requests WHERE created_at > NOW() - INTERVAL '1 day';"

# 5. Apuntar la app a la rama restaurada
flyctl secrets set DATABASE_URL="<connection-string-nueva>" \
  --app city2cruise-production-backend

# 6. Volver a escalar
flyctl scale count 2 --app city2cruise-production-backend

# 7. Smoke test
make production-smoke

# 8. Comunicar a usuarios afectados
```

**Post-mortem obligatorio.** Documentar en `docs/runbooks/incidents/`.

### 2. Caída de Fly.io en MAD (región primaria)

**Síntomas:** alertas de health check, latencia >5s, downdetector, etc.

**Procedimiento (RTO objetivo: 15 min):**

En producción ya hay réplica en CDG (`fly_region_extra = ["cdg"]`).
Fly.io enruta automáticamente. Si la réplica también cae:

```bash
# 1. Verificar status
flyctl status --app city2cruise-production-backend

# 2. Forzar región alternativa
flyctl regions set fra cdg --app city2cruise-production-backend
flyctl scale count 2 --app city2cruise-production-backend --region fra

# 3. Smoke
make production-smoke
```

### 3. Upstash caído / corrupto

**Síntomas:** caché vacía repetidamente, errores ECONNREFUSED al Redis,
sesiones expiran instantáneamente.

**Procedimiento (RTO objetivo: 20 min):**

Redis es **stateless cache**. Pérdida total no afecta integridad de
datos, sólo rendimiento durante 5–10 min mientras se rehace caché.

```bash
# 1. Crear nueva DB Upstash (puede ser desde la consola web o terraform)
cd terraform/flyneonupstash
terraform taint upstash_redis_database.cache
terraform apply -var-file=production.tfvars -auto-approve
# → terraform output -raw redis_url

# 2. Inyectar en Fly
flyctl secrets set REDIS_URL="<nuevo>" REDIS_TOKEN="<nuevo>" \
  --app city2cruise-production-backend

# 3. Las sesiones JWT se reemiten en próximo login (no es DR crítico)
```

### 4. Rollback de release (deploy malo)

**Síntomas:** errores nuevos tras deploy de un tag concreto.

**Procedimiento (RTO objetivo: 5 min):**

```bash
# 1. Listar releases
flyctl releases --app city2cruise-production-backend
# → busca el "version" anterior estable

# 2. Desplegar imagen anterior
flyctl deploy --remote-only \
  --app city2cruise-production-backend \
  --image ghcr.io/pablete64/city2cruise-backend:vX.Y.Z-anterior \
  --strategy bluegreen

# 3. Smoke
make production-smoke
```

### 5. Pérdida total de cuenta Fly.io

**Procedimiento (RTO objetivo: <4h):**

Reconstruir todo desde código:

```bash
# 1. Crear cuenta Fly nueva, autenticarse
flyctl auth signup
flyctl auth login

# 2. Variables nuevas
export FLY_API_TOKEN=$(flyctl auth token)
export TF_VAR_fly_api_token=$FLY_API_TOKEN
export TF_VAR_fly_org_slug="<nuevo-org>"

# 3. Aplicar terraform
make production-apply

# 4. Restaurar DB (Neon es independiente, sigue viva)
#    O restore desde backup más reciente si Neon también cae:
./scripts/backup/restore-from-pitr.sh "<timestamp último válido>"

# 5. Inyectar secrets desde GH Secrets / Vault
flyctl secrets set --app city2cruise-production-backend \
  DATABASE_URL=... REDIS_URL=... JWT_SECRET=... ...

# 6. Deploy última imagen estable
flyctl deploy --image ghcr.io/pablete64/city2cruise-backend:latest \
  --app city2cruise-production-backend

# 7. Repointar DNS / Cloudflare Pages al nuevo backend
```

## Pruebas periódicas

| Test | Frecuencia | Responsable | Última ejecución |
|---|---|---|---|
| Backup snapshot success | diario (auto, GH Actions) | sistema | <ver workflow> |
| Restore drill (staging) | trimestral | on-call rotativo | pendiente Q3-2026 |
| Failover drill (Fly region) | semestral | tech lead | pendiente Q4-2026 |
| Tabletop exercise DR completo | anual | todo el equipo | pendiente 2026 |

Drill de restore en staging: `make staging-apply` desde una rama sucia
y confirmar que pull -> apply restaura el estado correcto.

## Contactos de escalación

| Rol | Persona | Canal |
|---|---|---|
| On-call | rotación semanal | #city2cruise-oncall (Slack) |
| Tech lead | Pablo | pablo@reker.es |
| Cloud accounts | Pablo | (root accounts en 1Password) |
| Neon support | — | https://console.neon.tech/support |
| Fly.io support | — | https://fly.io/support |

## Validación SLA

Última estimación con métricas reales (Hito 4.3.5 + tests TF):

| Métrica | Objetivo | Alcanzable hoy | Gap |
|---|---|---|---|
| RPO | <1h | ~5 min (PITR Neon) | ✅ con margen |
| RTO escenario 1 (DB) | <4h | ~30 min documentado | ✅ |
| RTO escenario 2 (region) | <4h | <15 min auto-failover | ✅ |
| RTO escenario 5 (cuenta total) | <4h | ~2-3h estimado | ✅ con drill |

**Conclusión:** SLA RPO<1h / RTO<4h **alcanzable** con la
infraestructura definida en Hito 5.2.2. Los dos drills pendientes
(restore trimestral y failover semestral) deben programarse antes de
considerar la promesa "vendible".
