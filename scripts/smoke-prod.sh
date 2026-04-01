#!/usr/bin/env bash

set -euo pipefail

APP_URL="${1:-${NEXT_PUBLIC_APP_URL:-https://xm-email.vercel.app}}"
APP_URL="${APP_URL%/}"

PASS_COUNT=0
FAIL_COUNT=0

tmp_body="$(mktemp)"
trap 'rm -f "$tmp_body"' EXIT

check_status() {
  local method="$1"
  local path="$2"
  local expected_status="$3"
  local expected_substring="${4:-}"
  local payload="${5:-}"

  local status
  if [[ -n "$payload" ]]; then
    status="$(curl -sS -o "$tmp_body" -w "%{http_code}" -X "$method" "$APP_URL$path" -H "Content-Type: application/json" -d "$payload")"
  else
    status="$(curl -sS -o "$tmp_body" -w "%{http_code}" -X "$method" "$APP_URL$path")"
  fi

  if [[ "$status" != "$expected_status" ]]; then
    echo "FAIL: $method $path expected $expected_status got $status"
    echo "Body: $(head -c 300 "$tmp_body")"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    return
  fi

  if [[ -n "$expected_substring" ]] && ! grep -Fq "$expected_substring" "$tmp_body"; then
    echo "FAIL: $method $path missing body text: $expected_substring"
    echo "Body: $(head -c 300 "$tmp_body")"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    return
  fi

  echo "PASS: $method $path -> $status"
  PASS_COUNT=$((PASS_COUNT + 1))
}

echo "Running production smoke checks against $APP_URL"

check_status "GET" "/api/webhooks/brevo/register" "405"
check_status "POST" "/api/webhooks/brevo/register" "401" "Unauthorized"
check_status "GET" "/api/campaigns" "401"
check_status "GET" "/api/integrations/brevo/observability" "401"
check_status "POST" "/api/campaigns/ai-builder" "401" "Unauthorized" '{"prompt":"smoke test"}'

echo "Smoke checks complete: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi
