# Hito 00 — Base de la rama `FINAL` (Capítulo 0)

**Fecha:** 2026-04-29
**Rama integradora:** `FINAL` (creada desde `phase2-4` SHA `3b60f88`)
**Tag de evidencia:** `pre-remediation-2026-04-29`
**Owner:** pablete64 (`pablo@reker.es`)

---

## 1. Estrategia adoptada

La rama `FINAL` es la **integradora** del programa de remediación post-auditoría.
Sustituye, para esta organización, al nombre `fix/audit-remediation-2026-04`
mencionado en la Hoja de Ruta de Remediación (capítulo 0.1) por petición del
owner del repositorio.

- Base elegida: **`phase2-4`** (`3b60f88` — feat: implement RL-based fleet
  rebalancing job and add latency resilience tests for dispatch services).
  Esta rama refleja el estado completo del proyecto entregado e incluye
  `FASE4-FASE5-FASE6` + Hito 7 (RL/rebalanceo) + parches posteriores.
- Granularidad de PR: **commit + tag por hito** (`hito-H-X.Y-completed`),
  agrupados en bloques de fase sobre `FINAL`. Al cierre del Capítulo 1 se
  promueve la integradora a `main` vía PR.
- Conventional Commits: enforced por `commitlint.config.cjs` y
  `.github/workflows/commitlint.yml`.
- Semantic-release: activo (`.releaserc.json`) en `main`, `develop`,
  `FASE4-FASE5-FASE6`. `FINAL` queda fuera del flujo de release-notes
  automáticas porque es una rama de trabajo temporal.

## 2. Snapshot pre-remediación

### 2.1 `npm audit` backend

Resultado: **0 vulnerabilidades en cualquier severidad**.

```json
{ "info": 0, "low": 0, "moderate": 0, "high": 0, "critical": 0, "total": 0 }
```

Evidencia: [`audits/pre-remediation/audit-backend-pre.json`](audits/pre-remediation/audit-backend-pre.json)

### 2.2 `npm audit` frontend

Resultado: **7 vulnerabilidades — 5 moderate, 2 high, 0 critical**.

```json
{ "info": 0, "low": 0, "moderate": 5, "high": 2, "critical": 0, "total": 7 }
```

Las 2 highs se corresponden 1-a-1 con S-02 de la auditoría:

| Paquete | Severidad | Resumen |
| --- | --- | --- |
| `axios`  | high | SSRF + Credential Leakage via Absolute URL; DoS por falta de chequeo de tamaño; `__proto__` en `mergeConfig`; NO_PROXY hostname normalization bypass; Cloud Metadata Exfiltration via Header Injection |
| `lodash` | high | Prototype Pollution en `_.unset` y `_.omit`; Code Injection via `_.template`; Prototype Pollution via array path bypass |

Evidencia: [`audits/pre-remediation/audit-frontend-pre.json`](audits/pre-remediation/audit-frontend-pre.json)

Estas dos serán resueltas en **Hito H-1.2**.

### 2.3 `docker build` + `docker scout cves`

Estado: **GAP CONOCIDO** — el sandbox de ejecución no dispone del daemon de
Docker, por lo que no se ha podido generar la evidencia automatizada de
escaneo de imágenes durante el snapshot.

Acción requerida del owner local antes de mergear `FINAL` a `main`:

```bash
cd <repo>
docker build -t city2cruise-backend:pre  ./backend
docker build -t city2cruise-frontend:pre ./cruise-connect-main
docker scout cves city2cruise-backend:pre  > docs/devops/audits/pre-remediation/scout-backend-pre.txt
docker scout cves city2cruise-frontend:pre > docs/devops/audits/pre-remediation/scout-frontend-pre.txt
git add docs/devops/audits/pre-remediation/scout-*.txt
git commit -m "docs(audit): add docker scout pre-remediation evidence"
```

## 3. Criterio de cierre del programa de remediación

`FINAL` se promueve a `main` cuando:

1. Los **38 hitos** del documento `HOJA_DE_RUTA_REMEDIACION_2026-04-29.pdf`
   están cerrados (commits con conventional message + tag por hito).
2. `npm audit --audit-level=high` retorna **0 hallazgos** en backend y
   frontend.
3. Workflow `zap-baseline.yml` corre **en verde** sobre staging real.
4. Re-auditoría a 30 días (Capítulo 8) firmada y archivada en
   `docs/devops/audits/post-remediation/`.

## 4. Convenciones operativas

- Cada commit que cierra un hito incluye `Closes #H-X.Y` en el cuerpo y
  conventional commit type apropiado (`fix:` para vulnerabilidades, `chore:`
  para configuración, `docs:` para documentación, `test:` para nuevos tests).
- Cada hito que toque seguridad o configuración se acompaña de su entrada en
  `docs/devops/HITO_REMEDIACION_H-X.Y.md` con evidencias.
- CI obligatorio en cada commit de `FINAL`: lint + tsc + jest + vitest + build
  + audit + docker-build (cuando aplica).

## 5. Trazabilidad

- Hoja de ruta origen: `HOJA_DE_RUTA_REMEDIACION_2026-04-29.pdf`
- Auditoría origen:    `AUDITORIA_TECNICA_INTEGRAL_2026-04-29.pdf`
- Tag de snapshot:     `pre-remediation-2026-04-29`
