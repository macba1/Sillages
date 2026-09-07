#!/usr/bin/env bash
#
# The full validation procedure. Everything CI runs, in the same order, plus the
# integration suite against a real database.
#
# Run this before asking anyone to review the branch.
#
#   ./scripts/validate.sh          full run, boots a local Supabase
#   ./scripts/validate.sh --quick  skips the integration suite, and says so
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
QUICK="${1:-}"

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; exit 1; }

step() {
  local label="$1"; shift
  if "$@" >/tmp/sillages-validate.log 2>&1; then
    pass "$label"
  else
    tail -30 /tmp/sillages-validate.log
    fail "$label"
  fi
}

echo
echo "Backend"
cd "$REPO_ROOT/backend"
step "lint"        npm run lint
step "type check"  npm run type-check
step "unit tests"  npm test
step "build"       npm run build

echo
echo "Frontend"
cd "$REPO_ROOT/frontend"
step "lint"                    npm run lint
step "type check"              npm run type-check
step "tests"                   npm test
VITE_PRODUCT_MODE=legacy         step "build (legacy)"         npm run build
VITE_PRODUCT_MODE=social_gallery step "build (social_gallery)" npm run build

echo
echo "Integration"
cd "$REPO_ROOT"

if [ "$QUICK" = "--quick" ]; then
  printf '  \033[33m!\033[0m skipped on request — cross-shop isolation, row level security,\n'
  printf '      GDPR erasure, metric aggregates and retention were NOT verified.\n'
  printf '      This branch is not validated until they are.\n'
  echo
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  fail "Docker is not running, so the integration suite cannot be verified. Start Docker, or re-run with --quick and accept that the branch is not validated."
fi

"$REPO_ROOT/scripts/dev-supabase.sh" start >/tmp/sillages-supabase.log 2>&1 || {
  tail -30 /tmp/sillages-supabase.log
  fail "could not start the local database"
}
pass "local database up, migrations applied"

# The suite must actually run. A skip here would look green and prove nothing.
if "$REPO_ROOT/scripts/dev-supabase.sh" test >/tmp/sillages-integration.log 2>&1; then
  if grep -qE '[0-9]+ skipped' /tmp/sillages-integration.log; then
    tail -30 /tmp/sillages-integration.log
    fail "the integration suite reported skipped tests — it did not actually run"
  fi
  pass "integration suite ($(grep -oE 'Tests +[0-9]+ passed' /tmp/sillages-integration.log | tail -1))"
else
  tail -40 /tmp/sillages-integration.log
  fail "integration suite"
fi

echo
echo "Everything passed."
echo "Still unverified, and not verifiable here: anything that needs a real"
echo "Shopify store — the catalogue API, webhooks, the theme extension, the Web"
echo "Pixel and billing. See docs/billing-and-launch.md."
echo
