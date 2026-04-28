#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/backup/restore-from-pitr.sh
# Restaura una rama Neon a un punto en el tiempo (PITR). Crea una rama
# nueva apuntando al timestamp dado y la hace endpoint primario nuevo.
#
# USO: ./restore-from-pitr.sh "2026-04-28T13:00:00Z"
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

: "${NEON_API_KEY:?NEON_API_KEY no definido}"
: "${NEON_PROJECT_ID:?NEON_PROJECT_ID no definido}"

if [ $# -lt 1 ]; then
  echo "Uso: $0 <timestamp ISO8601 UTC>"
  echo "Ejemplo: $0 \"2026-04-28T13:00:00Z\""
  exit 1
fi

TIMESTAMP="$1"
RESTORE_NAME="restore-$(date -u +%Y%m%d-%H%M%S)"

echo ">> Creando rama de restore Neon a ${TIMESTAMP}: ${RESTORE_NAME}"
curl -fsS -X POST "https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}/branches" \
  -H "Authorization: Bearer ${NEON_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"branch\": {
      \"name\": \"${RESTORE_NAME}\",
      \"parent_timestamp\": \"${TIMESTAMP}\"
    },
    \"endpoints\": [{ \"type\": \"read_write\" }]
  }" \
  | tee /tmp/restore-out.json

ENDPOINT_HOST=$(jq -r '.endpoints[0].host' /tmp/restore-out.json)
echo ""
echo ">> Restore listo. Connection string nueva:"
echo "   postgres://USER:PWD@${ENDPOINT_HOST}/city2cruise?sslmode=require"
echo ""
echo ">> Para activarlo en producción:"
echo "   1. Validar datos:  psql 'postgres://...@${ENDPOINT_HOST}/city2cruise' -c 'SELECT count(*) FROM users;'"
echo "   2. Cambiar Fly secret: flyctl secrets set DATABASE_URL='...' --app city2cruise-production-backend"
echo "   3. Verificar app: make production-smoke"
