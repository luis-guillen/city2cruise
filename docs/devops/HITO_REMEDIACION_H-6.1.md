# Hito H-6.1 — Reorganizar documentación histórica (I-03)

**Severidad:** INFO
**Owner:** Cualquiera
**Esfuerzo:** ~30 minutos
**Estado:** ✅ Cerrado

## Cambio

`docs/history/` (nuevo) recibe 8 documentos archivados desde la raíz:

| Antes | Después |
| --- | --- |
| `AUDITORIA_TECNICA_CITY2CRUISE.md` | `docs/history/AUDITORIA_TECNICA_CITY2CRUISE_v1_2026-03-17.md` (renombrado con fecha). |
| `RE_AUDITORIA_TECNICA_CITY2CRUISE_v2.md` | `docs/history/RE_AUDITORIA_TECNICA_CITY2CRUISE_v2.md` |
| `RESPUESTA_CONSULTAS_TECNICAS.md` | `docs/history/RESPUESTA_CONSULTAS_TECNICAS.md` |
| `PLAN_EJECUCION_v2.md` | `docs/history/PLAN_EJECUCION_v2.md` |
| `PLAN_EJECUCION_V3_MIGRACIONSQLITE.md` | `docs/history/PLAN_EJECUCION_V3_MIGRACIONSQLITE.md` |
| `PLAN_EJECUCION_AUDITORIA.md` | `docs/history/PLAN_EJECUCION_AUDITORIA.md` |
| `HITOS_A_REALIZAR.pdf` | `docs/history/HITOS_A_REALIZAR.pdf` |
| `HOJA_DE_RUTA_DE_DESARROLLO.docx` | `docs/history/HOJA_DE_RUTA_DE_DESARROLLO.docx` |

`docs/history/README.md` (nuevo) tabula cada documento con fecha, estado y
documento que lo supersede.

## Estado de la raíz tras el cambio

```
.gitignore
.releaserc.json
AUDITORIA_TECNICA_INTEGRAL_2026-04-29.pdf       # vivo
HOJA_DE_RUTA_REMEDIACION_2026-04-29.pdf         # vivo (este programa)
Makefile
README.md                                        # se rescribe en H-6.2
commitlint.config.cjs
docker-compose.yml
docker-compose.dev.yml
ecosystem.config.cjs
package.json
package-lock.json
docs/                                            # toda la documentación
backend/                                         # módulo backend
cruise-connect-main/                             # módulo frontend
digital_twin/                                    # módulo Python
rl_service/                                      # módulo Python
deploy/  docker/  envs/  k6/  observability/  scripts/  terraform/
.github/  .claude/  .zap/
```

## Trazabilidad

- Auditoría: hallazgo `I-03`.
- Hoja de ruta: capítulo 6, hito H-6.1.
- Tag: `hito-H-6.1-completed`.
