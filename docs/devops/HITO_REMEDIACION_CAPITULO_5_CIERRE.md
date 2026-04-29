# Cierre del Capítulo 5 — DevSecOps avanzado

**Fecha de cierre:** 2026-04-29
**Rama:** `FINAL` (commits `b4b667f` → `27eab4b`)
**Hitos cubiertos:** H-5.1, H-5.2, H-5.3, H-5.4 — todos cerrados.

## Resumen

| Hito | Severidad | Hallazgo | Estado | Tag |
| --- | --- | --- | --- | --- |
| H-5.1 | INFO | I-02 — sin SBOM ni image scan en CD | ✅ | `hito-H-5.1-completed` |
| H-5.2 | INFO | I-02 — imágenes sin firma cosign | ✅ | `hito-H-5.2-completed` |
| H-5.3 | INFO | sin branch protection formal con los nuevos checks | ✅ docs / acción manual | `hito-H-5.3-completed` |
| H-5.4 | INFO | sin pre-commit framework con secret scan | ✅ | `hito-H-5.4-completed` |

## Lo que cambia operativamente

**CD pipeline (`.github/workflows/cd.yml`):**

```
build-push  ──┬──→ security-scan (SBOM CycloneDX + Trivy HIGH/CRITICAL)
              │       └─→ artifacts: sbom-{backend,frontend}.cdx.json
              │       └─→ Security tab: SARIF
              │
              ├──→ sign (cosign keyless OIDC + verify)
              │
              └──┴──→ deploy-staging (necesita los 3)
                                │
                                └──→ deploy-production (manual gate)
```

Cualquier CVE HIGH+ con fix upstream **bloquea el deploy**. Cualquier
imagen no firmada por la pipeline oficial **falla el verify**.

**Pre-commit local:**

`pre-commit install` activa gitleaks + 5 hooks estándar antes de cada
commit. El comando `./scripts/install-hooks.sh` se autodetecta y elige
entre el framework `pre-commit` (preferido) y el script bash legacy.

**Branch protection:**

`docs/devops/HITO_REMEDIACION_H-5.3.md` deja el comando `gh api` listo
para aplicar las reglas con los 8 status checks correctos.

## Acciones del owner

1. **Aplicar branch protection** ejecutando el bloque `gh api` de
   `HITO_REMEDIACION_H-5.3.md` una vez. Requiere PAT con `admin:repo`.
2. **Habilitar Dependabot** (Settings → Code security → Dependabot version
   updates) — heredado de H-4.2.
3. **Primer push a `main`** disparará el nuevo CD: SBOM y Trivy
   aparecerán en Actions/Security; cosign keyless firmará las dos
   imágenes y dejará la firma en Rekor.
4. **`pip install pre-commit && ./scripts/install-hooks.sh`** una vez por
   máquina dev.

## Próximos capítulos

Capítulo 6 — Cumplimiento (RGPD, Stripe, accesibilidad).
Capítulo 7 — Continuidad (DR, backups).
