#!/usr/bin/env bash
# Hito 4.3.5 — Runner del load test de la Fase 4.
#
# Levanta backend + db + redis con docker-compose.dev.yml, espera a
# /api/health, ejecuta k6 con criterios estrictos y guarda el reporte.
#
# Uso:
#   ./scripts/k6-phase4.sh           # contra localhost:9000
#   BASE_URL=http://api.x ./scripts/k6-phase4.sh
set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:9000}"
OUT_DIR="${OUT_DIR:-docs/audits/k6}"
mkdir -p "$OUT_DIR"

echo "Esperando a $BASE_URL/api/health ..."
for i in {1..30}; do
  if curl -fsS "$BASE_URL/api/health" >/dev/null 2>&1; then break; fi
  sleep 1
done

if ! command -v k6 >/dev/null 2>&1; then
  echo "k6 no encontrado en PATH. Instala desde https://k6.io/docs/get-started/installation/"
  exit 2
fi

cd k6
echo "=== 100 VUs constantes (criterio aceptacion 4.3.5) ==="
k6 run --env BASE_URL="$BASE_URL" \
  --summary-export="../$OUT_DIR/100c-summary.json" \
  phase4-100c.js | tee "../$OUT_DIR/100c-stdout.txt"

echo ""
echo "=== Spike 200 VUs ==="
k6 run --env BASE_URL="$BASE_URL" \
  --summary-export="../$OUT_DIR/spike-summary.json" \
  phase4-spike.js | tee "../$OUT_DIR/spike-stdout.txt"

echo ""
echo "Reportes guardados en $OUT_DIR/"
