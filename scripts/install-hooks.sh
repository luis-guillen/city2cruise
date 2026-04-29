#!/usr/bin/env bash
# Instala los hooks de git del proyecto.
#
# Estrategia (Hito H-5.4):
# 1) pre-commit framework (Python) — preferido: gestiona gitleaks +
#    detect-private-key + checks varios. Ver .pre-commit-config.yaml.
# 2) Fallback bash: scripts/pre-commit-secrets.sh — sólo si pre-commit
#    no está disponible (devs sin Python).

set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)

if command -v pre-commit >/dev/null 2>&1; then
    echo "▶ pre-commit detectado, instalando hooks declarativos…"
    (cd "$ROOT" && pre-commit install)
    echo "✅ Hooks instalados via pre-commit (gitleaks, detect-private-key, …)."
    echo "   Para ejecutar contra todo el repo:"
    echo "       pre-commit run --all-files"
else
    echo "⚠ pre-commit no encontrado. Instalando fallback bash."
    echo "  (Recomendado: pip install pre-commit && rerun este script.)"
    ln -sf "../../scripts/pre-commit-secrets.sh" "$ROOT/.git/hooks/pre-commit"
    chmod +x "$ROOT/.git/hooks/pre-commit"
    echo "✅ Hook pre-commit (fallback) instalado: scripts/secrets-audit.sh"
fi
