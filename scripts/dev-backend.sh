#!/usr/bin/env bash
#
# Backend launcher for `shopify app dev`.
#
# Bridges what the Shopify CLI provides to what this service expects, and never
# writes a credential anywhere:
#
#   SHOPIFY_API_KEY / SHOPIFY_API_SECRET   set by the CLI, used as-is
#   HOST / SHOPIFY_APP_URL                 the CLI's tunnel, mapped to SHOPIFY_APP_URL
#   BACKEND_PORT                           the port the CLI expects us to listen on
#
# Everything else — the local Supabase keys, PRODUCT_MODE — comes from
# backend/.env.dev, which is gitignored. dotenv does not override variables that
# are already present, so the CLI's credentials take precedence over that file.
set -euo pipefail

cd "$(dirname "$0")/../backend"

# The CLI names its tunnel differently across versions; accept either.
export SHOPIFY_APP_URL="${SHOPIFY_APP_URL:-${HOST:-}}"
if [ -z "$SHOPIFY_APP_URL" ]; then
  echo "[dev-backend] No tunnel URL from the CLI (HOST/SHOPIFY_APP_URL unset)." >&2
  echo "[dev-backend] Run this through 'shopify app dev --config dev'." >&2
  exit 1
fi

export PORT="${BACKEND_PORT:-${PORT:-3011}}"
export PRODUCT_MODE="${PRODUCT_MODE:-social_gallery}"

# The CLI publishes the app's real scopes as SCOPES; the backend reads
# SHOPIFY_SCOPES, whose default is the legacy twelve-scope string. Without this
# mapping a development install asked merchants for permissions the new product
# never uses.
if [ -n "${SCOPES:-}" ]; then
  export SHOPIFY_SCOPES="$SCOPES"
  echo "[dev-backend] scopes from CLI: $SCOPES"
fi
export DOTENV_CONFIG_PATH="${DOTENV_CONFIG_PATH:-$(pwd)/.env.dev}"

# Billing must stay in Shopify test mode for the whole of development. Refuse to
# start rather than silently allow a real charge.
if [ "${SHOPIFY_BILLING_LIVE:-}" = "true" ]; then
  echo "[dev-backend] SHOPIFY_BILLING_LIVE=true is not allowed in development." >&2
  exit 1
fi

echo "[dev-backend] product=$PRODUCT_MODE port=$PORT app_url=$SHOPIFY_APP_URL"
echo "[dev-backend] credentials supplied by the Shopify CLI (not printed)"

exec npm run dev
