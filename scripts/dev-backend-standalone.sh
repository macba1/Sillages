#!/usr/bin/env bash
#
# Runs the backend directly behind a stable tunnel, outside `shopify app dev`.
#
# `shopify app dev` overrides the app's redirect URLs live with its own, which
# made OAuth fail against the URLs we deploy. Running the backend ourselves
# means the released app version is the only thing that decides them.
#
# Credentials come from .env.dev.shopify, written by `shopify app env pull`.
# Both env files are gitignored and neither is ever printed.
set -euo pipefail
cd "$(dirname "$0")/../backend"

TUNNEL="${1:?usage: dev-backend-standalone.sh <tunnel-url> [port]}"
PORT_ARG="${2:-54999}"

# Order matters: the local file first, then the credentials pulled from the
# CLI, so a placeholder like `SHOPIFY_API_SECRET=` in .env.dev cannot overwrite
# the real value. Getting this backwards left the secret empty and the server
# refused to boot — which is the env validation doing its job.
set -a
# shellcheck disable=SC1091
[ -f .env.dev ] && . .env.dev
[ -f ../.env.dev.shopify ] && . ../.env.dev.shopify
set +a

export SHOPIFY_APP_URL="$TUNNEL"
export SHOPIFY_SCOPES="${SCOPES:-read_products,read_inventory,write_pixels,read_customer_events,read_orders}"
export PORT="$PORT_ARG"
export PRODUCT_MODE=social_gallery
export FRONTEND_URL="${FRONTEND_URL:-http://localhost:5183}"
unset SHOPIFY_BILLING_LIVE

echo "[standalone] product=$PRODUCT_MODE port=$PORT app_url=$SHOPIFY_APP_URL"
echo "[standalone] scopes=$SHOPIFY_SCOPES"
exec npx tsx watch src/index.ts
