#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   WHATSAPP_APP_SECRET=... bash apps/cloudflare-worker/scripts/post-local-webhook.sh
#   WHATSAPP_APP_SECRET=... bash apps/cloudflare-worker/scripts/post-local-webhook.sh "hello, how are you"
#
# Optional env vars:
#   WEBHOOK_URL           (default: http://127.0.0.1:8787/webhooks)
#   TEST_FROM             (default: 15198544596)
#   TEST_PHONE_NUMBER_ID  (default: 1063260676863328)

WEBHOOK_URL="${WEBHOOK_URL:-http://127.0.0.1:8787/webhooks}"
MESSAGE="${1:-hello, how are you}"
TEST_FROM="${TEST_FROM:-15198544596}"
TEST_PHONE_NUMBER_ID="${TEST_PHONE_NUMBER_ID:-1063260676863328}"
TIMESTAMP="$(date +%s)"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

load_env_file() {
  local env_file="$1"
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
}

# Load local env files if present. Existing exported env vars still take precedence.
load_env_file "${WORKER_DIR}/.env"
load_env_file "${WORKER_DIR}/.dev.vars"
load_env_file "${PWD}/.env"
load_env_file "${PWD}/.dev.vars"

if [[ -z "${WHATSAPP_APP_SECRET:-}" ]]; then
  echo "Error: WHATSAPP_APP_SECRET is required (set env var or add it to .env/.dev.vars)" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required" >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "Error: openssl is required" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is required" >&2
  exit 1
fi

JSON_MESSAGE="$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$MESSAGE")"

PAYLOAD="$(cat <<EOF
{
  \"object\": \"whatsapp_business_account\",
  \"entry\": [
    {
      \"id\": \"local-test-entry\",
      \"changes\": [
        {
          \"field\": \"messages\",
          \"value\": {
            \"messaging_product\": \"whatsapp\",
            \"metadata\": {
              \"display_phone_number\": \"15555550123\",
              \"phone_number_id\": \"${TEST_PHONE_NUMBER_ID}\"
            },
            \"messages\": [
              {
                \"from\": \"${TEST_FROM}\",
                \"id\": \"wamid.local.${TIMESTAMP}\",
                \"timestamp\": \"${TIMESTAMP}\",
                \"type\": \"text\",
                \"text\": {
                  \"body\": ${JSON_MESSAGE}
                }
              }
            ]
          }
        }
      ]
    }
  ]
}
EOF
)"

SIGNATURE="$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$WHATSAPP_APP_SECRET" -hex | awk '{print $NF}')"

echo "Posting signed webhook to: $WEBHOOK_URL"
echo "Message: $MESSAGE"
echo

TMP_BODY="$(mktemp)"
trap 'rm -f "$TMP_BODY"' EXIT

HTTP_CODE="$(curl -sS -o "$TMP_BODY" -w "%{http_code}" -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=$SIGNATURE" \
  --data "$PAYLOAD")"

echo "Status: $HTTP_CODE"
echo "Response body:"
cat "$TMP_BODY"
echo
