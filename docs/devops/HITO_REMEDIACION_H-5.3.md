# Hito H-5.3 — Branch protection rules formales

**Severidad:** INFO
**Owner:** Owner del repositorio (pablete64)
**Esfuerzo:** ~30 minutos
**Estado:** ✅ Cerrado en cuanto a documentación; requiere **una acción
manual del owner** en GitHub Settings (no se puede aplicar 100 % por
código sin GitHub App). El comando `gh api` para automatizarla está
incluido más abajo.

## Relación con `HITO_5_1_3_BRANCH_PROTECTION.md`

Ese documento (que ya existe en el repo desde el ciclo anterior) es la
base. Este hito **lo actualiza con los nuevos checks** introducidos por
H-5.1 (security-scan) y H-5.2 (sign), y deja el set de status checks
listo para copy-paste.

## Status checks obligatorios sobre `main`

Los nombres son los de la columna **Job** que GitHub muestra (no el
`name:`):

| Job | Workflow | Origen |
| --- | --- | --- |
| `frontend` | `ci.yml` | preexistente |
| `backend` | `ci.yml` | preexistente |
| `security` | `ci.yml` | preexistente |
| `docker-build` | `ci.yml` | preexistente |
| `digital-twin` | `ci.yml` | preexistente |
| `rl-service-bridge` | `ci.yml` | preexistente |
| `e2e` | `e2e.yml` | preexistente |
| `commitlint` | `commitlint.yml` | preexistente |
| `zap-baseline` | `zap-baseline.yml` | preexistente (nightly) |
| **`security-scan`** | `cd.yml` | **nuevo H-5.1** |
| **`sign`** | `cd.yml` | **nuevo H-5.2** |

> Nota: `security-scan` y `sign` corren tras `build-push` en el workflow
> `cd.yml`, que se dispara en push a `main` y en tags. En PRs no se
> ejecutan, así que **no deben listarse como status checks de PR**. Lo que
> sí debe hacerse es exigir que `cd.yml` haya tenido éxito en el commit
> antes del merge a `main`, vía un environment con required reviewers
> (ya configurado en `production`).

## Reglas mínimas (Settings → Rules → Rulesets)

Sobre la base ya documentada en `HITO_5_1_3_BRANCH_PROTECTION.md`:

- Target branches: `main` (Include default branch).
- Block force pushes: ✓
- Restrict deletions: ✓
- Require a pull request before merging: ✓
  - Required approvals: **1**
  - Dismiss stale approvals on new commits: ✓
  - Require review from Code Owners: ✓
- Require status checks: ✓
  - Required (orden recomendado):
    `frontend`, `backend`, `security`, `docker-build`, `digital-twin`,
    `rl-service-bridge`, `e2e`, `commitlint`.
  - Strict (must be up to date with base): ✓
- Require linear history: ✓
- Require signed commits: ✓ (recomendado, no bloqueante para H-5.3).
- Require conversation resolution: ✓
- Require deployments: ✓ con environment `staging` (ya existe).

## Aplicar vía `gh api`

```bash
REPO=pablete64/APP_TRASNPORTE_LOCKERS_BARCELONA

gh api -X PUT "repos/$REPO/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "frontend",
      "backend",
      "security",
      "docker-build",
      "digital-twin",
      "rl-service-bridge",
      "e2e",
      "commitlint"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": true,
  "required_conversation_resolution": true
}
JSON
```

## Acciones que hacen cumplir la regla

- Tras aplicar la protección, intentar un `git push --force-with-lease`
  contra `main` desde otra rama debe ser **rechazado** por GitHub.
- Un PR sin las 8 status checks en verde no muestra el botón "Merge".
- Un PR sin aprobación del Code Owner queda bloqueado por
  "Require review from Code Owners".

## Verificación post-aplicación

```bash
gh api "repos/pablete64/APP_TRASNPORTE_LOCKERS_BARCELONA/branches/main/protection" \
    | jq '{ status_checks: .required_status_checks.contexts,
            strict: .required_status_checks.strict,
            reviews: .required_pull_request_reviews.required_approving_review_count,
            force_push: .allow_force_pushes.enabled,
            linear: .required_linear_history.enabled }'
```

Salida esperada: 8 contexts, strict true, reviews 1, force_push false,
linear true.

## Trazabilidad

- Hoja de ruta: capítulo 5, hito H-5.3.
- Doc base: `HITO_5_1_3_BRANCH_PROTECTION.md`.
- Tag: `hito-H-5.3-completed`.
