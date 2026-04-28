#!/usr/bin/env bash
# Instala los hooks de git del proyecto.
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
ln -sf "../../scripts/pre-commit-secrets.sh" "$ROOT/.git/hooks/pre-commit"
chmod +x "$ROOT/.git/hooks/pre-commit"
echo "✅ Hook pre-commit instalado: ejecuta scripts/secrets-audit.sh"
