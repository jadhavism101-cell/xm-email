#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

APP_URL="${NEXT_PUBLIC_APP_URL:-https://xm-email.vercel.app}"

echo "Deploying to production..."
npx vercel deploy --prod --yes

echo "Running post-deploy smoke checks..."
bash "$ROOT_DIR/scripts/smoke-prod.sh" "$APP_URL"

echo "Release complete."
