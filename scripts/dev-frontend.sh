#!/usr/bin/env bash
#
# Admin launcher for `shopify app dev`. Points the admin at the backend the CLI
# just started, in social_gallery mode.
set -euo pipefail

cd "$(dirname "$0")/../frontend"

export VITE_PRODUCT_MODE="${VITE_PRODUCT_MODE:-social_gallery}"
export PORT="${FRONTEND_PORT:-${PORT:-5183}}"
export VITE_API_URL="${VITE_API_URL:-http://localhost:${BACKEND_PORT:-3011}}"

echo "[dev-frontend] product=$VITE_PRODUCT_MODE port=$PORT api=$VITE_API_URL"

exec npx vite --port "$PORT" --strictPort
