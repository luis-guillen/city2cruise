# Cierre del Capítulo 6 — Documentación y operación

**Fecha de cierre:** 2026-04-29
**Rama:** `FINAL` (commits `583735e` → `24496b4`)
**Hitos cubiertos:** H-6.1, H-6.2, H-6.3 — todos cerrados.

## Resumen

| Hito | Severidad | Hallazgo | Estado | Tag |
| --- | --- | --- | --- | --- |
| H-6.1 | INFO | I-03 — docs históricos en raíz | ✅ | `hito-H-6.1-completed` |
| H-6.2 | INFO | sin README de raíz | ✅ | `hito-H-6.2-completed` |
| H-6.3 | INFO | diagrama arquitectura desactualizado | ✅ | `hito-H-6.3-completed` |

## Estado de la documentación tras Cap. 6

**Raíz**: `README.md` (índice, 195 líneas, con badges + diagrama
embebido), 2 PDFs vivos (`AUDITORIA_TECNICA_INTEGRAL_2026-04-29.pdf`,
`HOJA_DE_RUTA_REMEDIACION_2026-04-29.pdf`), `Makefile`,
`commitlint.config.cjs`, `.releaserc.json`, configs de Docker compose.

**`docs/`**:

```
docs/
├── PHASE3_CLOSURE.md
├── architecture.mmd                 # H-6.3 nuevo
├── adr/                             # decisiones arquitectónicas
├── audits/                          # auditorías tipo a11y, lighthouse
├── devops/                          # 30+ docs HITO_*.md + SECURITY_POLICY
│   ├── HITO_REMEDIACION_INDEX.md
│   ├── HITO_REMEDIACION_00_BASE.md
│   ├── HITO_REMEDIACION_H-1.1.md … H-6.3.md
│   ├── HITO_REMEDIACION_CAPITULO_1_CIERRE.md … CAPITULO_6_CIERRE.md
│   ├── SECURITY_POLICY.md           # H-4.3
│   ├── HITO_5_1_3_BRANCH_PROTECTION.md
│   ├── HITO_5_2_*.md                # FASE 5
│   ├── HITO_5_3_*.md                # FASE 5
│   ├── HITO_5_4_*.md                # FASE 5
│   ├── HITO_6_*.md                  # FASE 6
│   └── audits/                      # snapshots npm audit, trivy, scout
│       ├── pre-remediation/
│       ├── post-h12/                # tras H-1.2
│       └── post-h41/                # tras H-4.1
├── history/                         # H-6.1 nuevo — superseded
│   ├── README.md                    # tabla con fecha y supersession
│   ├── AUDITORIA_TECNICA_CITY2CRUISE_v1_2026-03-17.md
│   ├── RE_AUDITORIA_TECNICA_CITY2CRUISE_v2.md
│   ├── RESPUESTA_CONSULTAS_TECNICAS.md
│   ├── PLAN_EJECUCION_v2.md
│   ├── PLAN_EJECUCION_V3_MIGRACIONSQLITE.md
│   ├── PLAN_EJECUCION_AUDITORIA.md
│   ├── HITOS_A_REALIZAR.pdf
│   └── HOJA_DE_RUTA_DE_DESARROLLO.docx
└── runbooks/
```

## Próximos capítulos

Capítulo 7 — Re-auditoría a 30 días + criterios de aceptación.
Capítulo 8 — Plan de mejora 30/60/90 días post-remediación.

## Pendientes acumulados (acciones del owner local)

1. Rotar VAPID en Fly (H-1.1).
2. Validar Docker imágenes con `docker run -u`/`docker inspect` (H-1.3).
3. Validar cabeceras contra staging real con securityheaders.com (H-1.4).
4. Borrar manualmente desde Finder los 3 ficheros zombi en
   `cruise-connect-main/` (H-2.3).
5. Habilitar Dependabot en GitHub Settings (H-4.2).
6. Aplicar branch protection con `gh api` (H-5.3).
7. Render PNG/SVG del diagrama si lo quieres como artifact estático
   (H-6.3): `npx @mermaid-js/mermaid-cli -i docs/architecture.mmd -o docs/architecture.png`.
