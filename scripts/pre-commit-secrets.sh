#!/usr/bin/env bash
# Pre-commit hook que ejecuta secrets-audit.sh sobre los archivos staged.
# Instalar con:
#   ln -sf ../../scripts/pre-commit-secrets.sh .git/hooks/pre-commit
set -uo pipefail

REPO=$(git rev-parse --show-toplevel)
exec "$REPO/scripts/secrets-audit.sh"
