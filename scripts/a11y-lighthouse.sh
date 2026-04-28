#!/usr/bin/env bash
# Hito 4.1.1 — Lighthouse Accessibility CI runner
#
# Ejecuta Lighthouse en modo accessibility-only contra un servidor local
# del frontend (vite preview o vite dev). Genera reportes JSON + HTML por
# cada ruta auditada, y sale con codigo != 0 si el score < 90.
#
# Uso:
#   ./scripts/a11y-lighthouse.sh           # corre contra http://localhost:9100
#   BASE_URL=https://staging.x ./scripts/a11y-lighthouse.sh
#
# Requiere: node 18+, chrome/chromium instalado.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:9100}"
OUT_DIR="${OUT_DIR:-docs/audits/lighthouse}"
MIN_SCORE="${MIN_SCORE:-90}"

ROUTES=(
  "/"
  "/client"
  "/driver"
  "/admin"
)

mkdir -p "$OUT_DIR"
echo "Running Lighthouse a11y audits against $BASE_URL"
echo "Min score required: $MIN_SCORE"

# Instala lighthouse on the fly si no esta
if ! command -v lighthouse >/dev/null 2>&1; then
  echo "Installing lighthouse via npx..."
  HAS_NPX=1
fi

FAILED=0
SUMMARY_JSON="$OUT_DIR/summary.json"
echo "[]" > "$SUMMARY_JSON"

for route in "${ROUTES[@]}"; do
  safe="${route//\//_}"
  safe="${safe:-_root}"
  url="${BASE_URL}${route}"
  json_out="$OUT_DIR/${safe}.json"
  html_out="$OUT_DIR/${safe}.html"

  echo ""
  echo "==> $url"
  npx --yes lighthouse "$url" \
    --only-categories=accessibility \
    --output=json --output=html \
    --output-path="$OUT_DIR/${safe}" \
    --chrome-flags="--headless=new --no-sandbox" \
    --quiet || true

  if [ -f "$json_out" ]; then
    score=$(node -e "const r=require('./$json_out'); console.log(Math.round((r.categories.accessibility.score||0)*100))")
    echo "    score: $score / 100"
    if [ "$score" -lt "$MIN_SCORE" ]; then
      echo "    FAIL (< $MIN_SCORE)"
      FAILED=1
    fi
    node -e "
      const fs=require('fs');
      const arr=JSON.parse(fs.readFileSync('$SUMMARY_JSON','utf8'));
      const r=require('./$json_out');
      arr.push({
        url: '$url',
        score: Math.round((r.categories.accessibility.score||0)*100),
        violations: Object.values(r.audits).filter(a => a.score !== null && a.score < 1).map(a => ({id: a.id, title: a.title, impact: a.score})).slice(0, 50),
      });
      fs.writeFileSync('$SUMMARY_JSON', JSON.stringify(arr, null, 2));
    "
  else
    echo "    ERROR: lighthouse did not produce $json_out"
    FAILED=1
  fi
done

echo ""
echo "Reports: $OUT_DIR"
if [ "$FAILED" -ne 0 ]; then
  echo "One or more routes failed the a11y threshold ($MIN_SCORE)."
  exit 1
fi
echo "All routes passed."
