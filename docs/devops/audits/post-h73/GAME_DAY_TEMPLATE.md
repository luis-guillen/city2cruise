# H-7.3 — Game Day DR (PITR Neon)

**Fecha:** _YYYY-MM-DD_
**Hora de inicio:** _HH:MM UTC_
**Operador on-call:** _alias_
**Observador (timer):** _alias_
**Comunicación:** Slack thread `#city2cruise-oncall`.

> ⚠ Este ensayo se ejecuta **sólo contra staging**. El comando que usa
> `flyctl secrets set` apunta al app `city2cruise-staging-backend`.

## Escenario simulado

Pérdida total de la base Postgres en Neon (rama `production-staging`)
provocada accidentalmente por un `DROP SCHEMA public CASCADE`.

Objetivo: restaurar desde PITR la versión de **anoche 03:00 UTC** y
medir RTO + RPO efectivos.

## Pre-flight (antes de iniciar el cronómetro)

| Paso | Hecho |
| --- | :---: |
| Comunicar inicio del game day en `#city2cruise-oncall`. | ☐ |
| Confirmar que la rama de staging tiene datos con `created_at < ahora-30min` para detectar pérdida real. | ☐ |
| Tener a mano `NEON_API_KEY`, `NEON_PROJECT_ID`, `FLY_API_TOKEN_STAGING`. | ☐ |
| Tener `psql` y `flyctl` instalados. | ☐ |
| Abrir Grafana de staging para anotar pérdida de tráfico. | ☐ |

## Cronómetro

| t | Acción | Hora real (UTC) |
| --- | --- | --- |
| `T0` | DROP SCHEMA simulado (`psql ... -c "DROP SCHEMA public CASCADE"`). Detección por `BackendDown` o `HighErrorRate`. | _HH:MM:SS_ |
| `T1` | Cortar tráfico: `flyctl scale count 0 --app city2cruise-staging-backend`. | _HH:MM:SS_ |
| `T2` | Identificar timestamp seguro (T0 - 1h margen). Lanzar `./scripts/backup/restore-from-pitr.sh "$TIMESTAMP"`. | _HH:MM:SS_ |
| `T3` | Validar la rama Neon: `psql "<conn-new>" -c "SELECT count(*) FROM users; SELECT count(*) FROM pickup_requests;"`. | _HH:MM:SS_ |
| `T4` | `flyctl secrets set DATABASE_URL="<conn-new>" --app city2cruise-staging-backend`. | _HH:MM:SS_ |
| `T5` | `flyctl scale count 2 --app city2cruise-staging-backend`. | _HH:MM:SS_ |
| `T6` | Smoke test: `make staging-smoke`. | _HH:MM:SS_ |
| `T7` | Servicio recuperado, anotación final en Grafana. | _HH:MM:SS_ |

## Resultados medidos

| Métrica | Objetivo | Resultado | Veredicto |
| --- | --- | --- | --- |
| **RTO** (T7 - T0) | < 4 h | _XXmm:ss_ | ✅ / ❌ |
| **RPO** (T0 - timestamp restaurado) | < 1 h | _Xmm:ss_ | ✅ / ❌ |
| Filas perdidas en `pickup_requests` | _N_ | _N_ documentado | ✅ / ❌ |
| Alertas que dispararon correctamente | `HighErrorRate`, `BackendDown` | _list_ | ✅ / ❌ |

## Pain points / mejoras

_Tres bullets máximo. Esto alimenta el PR de update del runbook._

1. _Falta de variable XYZ en el script automático → bloqueó N min._
2. __
3. __

## PR follow-up

- [ ] Issue abierto: `_#NN — DR_RUNBOOK update post-game-day_`.
- [ ] PR mergeado en `main`.
- [ ] Próximo game day programado: _YYYY-Q_.

## Post-mortem (formato blameless)

### Línea de tiempo
_Reproducción narrativa de los eventos T0..T7._

### Qué fue bien
_Cosas a preservar (acciones rápidas, herramientas que funcionaron, etc.)._

### Qué se puede mejorar
_Cosas a corregir (gaps en runbook, herramientas lentas, falta de
permisos, etc.)._

### Acciones (con owner y fecha)
| Acción | Owner | Fecha límite |
| --- | --- | --- |
| _…_ | _…_ | _…_ |

Firma: _alias_, _fecha_.
