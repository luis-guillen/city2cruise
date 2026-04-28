# Hito 5.1.3 — Branch protection (rama `main`)

> Esta configuración la aplica el dueño del repo desde GitHub UI, no se
> puede definir 100% por código sin GitHub App. Sí se puede automatizar
> vía Terraform GitHub provider o `gh api` (incluido al final).

## 1. Configuración recomendada (Settings → Rules → Rulesets)

Crea un **Ruleset "main protection"** con estos campos:

| Campo | Valor |
|---|---|
| Target branches | `main` (Include default branch) |
| Restrict creations | ✓ (solo apps autorizadas crean ramas con prefijo) |
| Restrict updates / deletions | ✓ |
| Block force pushes | ✓ |
| Require a pull request before merging | ✓ |
| → Required approvals | **1** mínimo |
| → Dismiss stale approvals on new commits | ✓ |
| → Require review from Code Owners | ✓ |
| → Require approval of the most recent reviewable push | ✓ |
| Require status checks | ✓ |
| → Required: | `frontend`, `backend`, `security`, `docker-build` (jobs del CI) |
| → Strict: branch must be up to date | ✓ |
| Require deployments | ✓ con environment `staging` |
| Require signed commits | ✓ (recomendado) |
| Require linear history | ✓ |
| Require conversation resolution | ✓ |

## 2. Environments (Settings → Environments)

Crea dos environments:

### `staging`
- **No** required reviewers (despliegue automático).
- Secrets: `FLY_API_TOKEN_STAGING`, `DATABASE_URL_STAGING`, `REDIS_URL_STAGING`,
  `JWT_SECRET_STAGING`, `SENTRY_DSN_STAGING`.
- Variables: `VITE_API_URL`, `VITE_SOCKET_URL`.

### `production`
- **Required reviewers**: dueño del repo + 1 más.
- **Wait timer**: 5 minutos (deshacer despliegues accidentales).
- Deployment branches: solo `main` o tags `v*.*.*`.
- Secrets: `FLY_API_TOKEN_PROD`, `STRIPE_SECRET_KEY`, `TWILIO_AUTH_TOKEN`,
  `JWT_SECRET_PROD`, `AUDIT_HMAC_SECRET_PROD`, `SENTRY_DSN_PROD`,
  `SLACK_WEBHOOK_URL`.

## 3. Aplicar via `gh` CLI (alternativa a la UI)

```bash
# Necesita gh y el token con admin:repo
REPO=pablete64/APP_TRASNPORTE_LOCKERS_BARCELONA

# Branch protection clasico (legacy API, simple para empezar)
gh api -X PUT "repos/$REPO/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["frontend", "backend", "security", "docker-build"]
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

# Environment production con reviewers
gh api -X PUT "repos/$REPO/environments/production" --input - <<'JSON'
{
  "wait_timer": 5,
  "reviewers": [{"type": "User", "id": YOUR_USER_ID}],
  "deployment_branch_policy": {
    "protected_branches": true,
    "custom_branch_policies": false
  }
}
JSON
```

## 4. Verificar

Tras aplicar:

```bash
gh api "repos/pablete64/APP_TRASNPORTE_LOCKERS_BARCELONA/branches/main/protection" | jq
```

Debe mostrar todos los campos activos.

## 5. CODEOWNERS

`.github/CODEOWNERS` declara quién aprueba qué. Combinado con
"Require review from Code Owners" en el ruleset, GitHub bloquea el merge
si los owners no han aprobado.

## 6. Plantillas

- `.github/pull_request_template.md`: checklist obligatorio (lint, tests,
  a11y, perf, docs).
- `.github/ISSUE_TEMPLATE/{bug_report,feature_request}.md`.
