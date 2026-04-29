#!/usr/bin/env bash
#
# Hito H-1.1 — Genera un par de claves VAPID nuevas para Web Push.
#
# Uso:
#   ./scripts/generate-vapid.sh                  # imprime claves en stdout
#   ./scripts/generate-vapid.sh --json           # JSON crudo (publicKey/privateKey)
#   ./scripts/generate-vapid.sh --env >> .env    # formato KEY=value para .env
#
# Después de generar, rotar el secreto en el orquestador:
#
#   fly secrets set \
#     VAPID_PUBLIC_KEY=<public> \
#     VAPID_PRIVATE_KEY=<private> \
#     --app city2cruise-backend
#
# Importante: las suscripciones existentes (pushManager.subscribe) caducan al
# cambiar la clave pública. El service worker del frontend re-suscribe a los
# usuarios automáticamente en su próxima sesión.

set -euo pipefail

OUT_FORMAT="${1:-pretty}"

if ! command -v npx >/dev/null 2>&1; then
    echo "ERROR: npx no encontrado. Instala Node 18+." >&2
    exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: jq no encontrado. brew install jq / apt install jq." >&2
    exit 1
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# web-push 3.x soporta --json desde npm; usamos npx para no requerir install global.
npx --yes web-push generate-vapid-keys --json > "$TMP"

PUB="$(jq -r .publicKey  "$TMP")"
PRV="$(jq -r .privateKey "$TMP")"

case "$OUT_FORMAT" in
    --json)
        cat "$TMP"
        ;;
    --env)
        echo "VAPID_PUBLIC_KEY=$PUB"
        echo "VAPID_PRIVATE_KEY=$PRV"
        ;;
    *)
        echo "Public:  $PUB"
        echo "Private: $PRV"
        echo
        echo "Para Fly:"
        echo "  fly secrets set VAPID_PUBLIC_KEY=\"$PUB\" VAPID_PRIVATE_KEY=\"$PRV\" --app city2cruise-backend"
        ;;
esac
