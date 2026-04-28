#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/backup/neon-snapshot.sh
# Crea un snapshot adicional (rama Neon) además del PITR continuo.
# Se ejecuta diariamente desde GitHub Actions cron (.github/workflows/backup.yml).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

: "${NEON_API_KEY:?NEON_API_KEY no definido}"
: "${NEON_PROJECT_ID:?NEON_PROJECT_ID no definido}"

TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
SNAPSHOT_NAME="snapshot-${TIMESTAMP}"

echo ">> Creando branch snapshot Neon: ${SNAPSHOT_NAME}"
curl -fsS -X POST "https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}/branches" \
  -H "Authorization: Bearer ${NEON_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"branch\":{\"name\":\"${SNAPSHOT_NAME}\"}}" \
  | tee /tmp/snapshot-out.json

# Política: mantener 7 snapshots (resto de la rama default + PITR cubre 7d)
echo ">> Listando snapshots existentes y purgando los más antiguos"
SNAPSHOTS=$(curl -fsS "https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}/branches" \
  -H "Authorization: Bearer ${NEON_API_KEY}" \
  | jq -r '.branches[] | select(.name | startswith("snapshot-")) | "\(.created_at) \(.id) \(.name)"' \
  | sort)

KEEP=7
TOTAL=$(echo "$SNAPSHOTS" | wc -l)
TO_DELETE=$((TOTAL - KEEP))

if [ "$TO_DELETE" -gt 0 ]; then
  echo ">> Borrando $TO_DELETE snapshots antiguos"
  echo "$SNAPSHOTS" | head -n "$TO_DELETE" | while read -r _ id name; do
    echo "   - $name ($id)"
    curl -fsS -X DELETE "https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}/branches/${id}" \
      -H "Authorization: Bearer ${NEON_API_KEY}"
  done
fi

echo ">> Snapshot creado correctamente: ${SNAPSHOT_NAME}"
