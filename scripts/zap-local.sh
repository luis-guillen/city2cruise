#!/usr/bin/env bash
# scripts/zap-local.sh — ejecutar OWASP ZAP localmente vía Docker
# Uso: ./scripts/zap-local.sh https://city2cruise-staging-backend.fly.dev
set -euo pipefail

TARGET="${1:-http://localhost:9000}"
mkdir -p ./.zap-reports

echo ">> Ejecutando ZAP baseline scan contra $TARGET ..."
docker run --rm \
  -v "$(pwd)/.zap-reports:/zap/wrk" \
  -v "$(pwd)/.zap:/zap/conf" \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py \
  -t "$TARGET" \
  -r baseline-report.html \
  -J baseline-report.json \
  -c /zap/conf/rules.tsv \
  -a -d || true

echo ">> Reports en .zap-reports/baseline-report.{html,json}"
