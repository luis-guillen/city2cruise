#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/secrets-audit.sh
# Auditoría LOCAL: busca secretos hardcodeados en el repo. Se ejecuta antes
# de cada release y como parte del CI security job (gitleaks ya cubre esto
# en CI; este script da feedback inmediato local sin instalar nada).
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

declare -i FOUND=0

scan() {
  local pattern="$1"
  local label="$2"
  local matches
  matches=$(git grep -nE "$pattern" -- \
    ':!*.lock' ':!*.lock.json' ':!*.svg' ':!*.png' ':!*.jpg' ':!*.pdf' \
    ':!docs/**' ':!*.md' ':!**/coverage/**' ':!*.tfvars.example' \
    ':!envs/*.example' 2>/dev/null || true)
  if [ -n "$matches" ]; then
    echo ""
    echo "❌ Posibles $label:"
    echo "$matches"
    FOUND=$((FOUND+1))
  fi
}

echo "==> Escaneando secretos hardcodeados..."

scan 'AKIA[0-9A-Z]{16}'                                "AWS access keys"
scan 'aws_secret_access_key.*=.*[A-Za-z0-9/+=]{40}'    "AWS secret keys"
scan 'sk_live_[A-Za-z0-9]{24,}'                        "Stripe live keys"
scan 'sk_test_[A-Za-z0-9]{24,}'                        "Stripe test keys"
scan 'ghp_[A-Za-z0-9]{36}'                             "GitHub PAT"
scan 'github_pat_[A-Za-z0-9_]{82}'                     "GitHub fine-grained PAT"
scan 'ghs_[A-Za-z0-9]{36}'                             "GitHub server token"
scan 'xox[baprs]-[A-Za-z0-9-]{10,}'                    "Slack tokens"
scan '-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----' "Private keys"
scan '\bAIza[0-9A-Za-z\-_]{35}\b'                      "Google API keys"
scan 'fly_[A-Za-z0-9_-]{40,}'                          "Fly.io tokens"
scan 'eyJ[A-Za-z0-9_-]{100,}'                          "JWT tokens largos"
scan 'postgres://[^@]+:[^@]+@(?!localhost|db|127\.0\.0\.1|host\.docker\.internal)' "DB URLs con credenciales no-locales"

if [ $FOUND -eq 0 ]; then
  echo "✅ Sin hallazgos."
  exit 0
else
  echo ""
  echo "🚨 $FOUND categoría(s) de hallazgos. Revisa antes de hacer push."
  echo "   Para excluir falsos positivos legítimos, añadir comentario justificativo."
  exit 1
fi
