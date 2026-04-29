# Hito H-8.1 — Re-auditoría npm + ZAP baseline

**Severidad:** INFO
**Owner:** DevOps
**Esfuerzo:** ~30 minutos
**Estado:** ✅ Cerrado para `npm audit`; **ZAP baseline contra staging
real** queda diferido al owner (mismo gap que H-1.4: el sandbox no llega
a la URL pública).

## Re-auditoría npm

### Backend

| Severidad | Pre-remediation (Cap. 0) | Post-remediation (2026-04-29) | Delta |
| --- | ---: | ---: | --- |
| critical | 0 | 0 | = |
| high     | 0 | 0 | = |
| moderate | 0 | 0 | = |
| low      | 0 | 0 | = |
| info     | 0 | 0 | = |
| **total**| **0** | **0** | **=** |

### Frontend

| Severidad | Pre-remediation (Cap. 0) | Post-remediation (2026-04-29) | Delta |
| --- | ---: | ---: | --- |
| critical | 0 | 0 | = |
| high     | 2 (axios, lodash) | **0** | **−2** |
| moderate | 5 (drift incl. 10 tras `npm install`) | **0** | **−10** |
| low      | 0 | 0 | = |
| info     | 0 | 0 | = |
| **total**| 7 → 10 (drift) | **0** | **−10** |

### Comando ejecutado

```bash
cd backend && npm audit --json > docs/devops/audits/post-remediation/2026-04-29/audit-backend-post.json
cd ../cruise-connect-main && npm audit --json > docs/devops/audits/post-remediation/2026-04-29/audit-frontend-post.json

# Diff
diff <(jq .metadata.vulnerabilities docs/devops/audits/pre-remediation/audit-backend-pre.json) \
     <(jq .metadata.vulnerabilities docs/devops/audits/post-remediation/2026-04-29/audit-backend-post.json)
diff <(jq .metadata.vulnerabilities docs/devops/audits/pre-remediation/audit-frontend-pre.json) \
     <(jq .metadata.vulnerabilities docs/devops/audits/post-remediation/2026-04-29/audit-frontend-post.json)
```

### Cierre del criterio del programa

Del `HITO_REMEDIACION_00_BASE.md` § 3:

> `npm audit --audit-level=high` retorna 0 hallazgos en backend y
> frontend.

✅ **Cumplido en ambos**. La condición es además más estricta: hay 0
hallazgos en **cualquier severidad** (no sólo high).

## ZAP baseline

`.github/workflows/zap-baseline.yml` ya existe en el repo. Para
disparar el run firmado de Cap. 8:

```bash
gh workflow run zap-baseline.yml \
    --ref main \
    -f target_url=https://city2cruise-staging.fly.dev
```

Esperado: workflow en verde, **0 nuevos warnings** sobre la baseline
ya commiteada en `.zap/rules.tsv`.

La evidencia (artifact `zap-report.html` + screenshot del run en verde)
se commitea como follow-up:

```
docs(audit): add H-8.1 ZAP baseline evidence
  → docs/devops/audits/post-remediation/2026-04-29/zap-report.html
  → docs/devops/audits/post-remediation/2026-04-29/zap-run.png
```

## Adjuntos en este hito

- `docs/devops/audits/post-remediation/2026-04-29/audit-backend-post.json`
  (committed).
- `docs/devops/audits/post-remediation/2026-04-29/audit-frontend-post.json`
  (committed).
- ZAP report — pendiente del run real.

## Trazabilidad

- Hoja de ruta: capítulo 8, hito H-8.1.
- Tag: `hito-H-8.1-completed`.
