#!/usr/bin/env bash
#
# Local Supabase for development and integration tests.
#
# Starts a throwaway Supabase stack in a scratch directory, applies the base
# schema plus every migration, and prints the command to run the integration
# suite against it.
#
# It never touches a hosted project: no `supabase link`, no remote push.
# The keys it prints are the Supabase CLI's well-known local demo keys — they
# are identical on every machine and are not secrets. Nothing here is committed.
#
#   ./scripts/dev-supabase.sh start   # boot + apply schema
#   ./scripts/dev-supabase.sh test    # run the integration suite against it
#   ./scripts/dev-supabase.sh stop    # tear everything down
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKDIR="${SILLAGES_DEV_SUPABASE_DIR:-${TMPDIR:-/tmp}/sillages-dev-supabase}"

require() { command -v "$1" >/dev/null || { echo "Missing: $1"; exit 1; }; }

db_container() { docker ps --format '{{.Names}}' | grep -m1 supabase_db_ || true; }

psql_file() {
  local container="$1" file="$2"
  docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -q < "$file"
}

cmd_start() {
  require docker
  require supabase

  mkdir -p "$WORKDIR"
  cd "$WORKDIR"
  [ -f supabase/config.toml ] || supabase init --force >/dev/null

  # The analytics/vector container mounts the docker socket, which Colima does
  # not support. Nothing here needs it.
  python3 - <<'PY'
import os, re, pathlib
p = pathlib.Path('supabase/config.toml')
s = p.read_text()
s = re.sub(r'(\[analytics\]\nenabled = )true', r'\1false', s)

# GoTrue only honours a redirect_to that is on its allow list, and falls back to
# site_url otherwise. Left at the default the OAuth install dropped the merchant
# on 127.0.0.1:3000, which nothing serves.
frontend = os.environ.get('DEV_FRONTEND_URL', 'http://localhost:5183')
s = re.sub(r'(?m)^site_url = .*$', 'site_url = "%s"' % frontend, s)
s = re.sub(
    r'(?m)^additional_redirect_urls = .*$',
    'additional_redirect_urls = ["%s", "%s/**"]' % (frontend, frontend),
    s,
)
p.write_text(s)
PY

  supabase start -x studio,edge-runtime,imgproxy,inbucket,logflare,vector,supavisor >/dev/null
  local container
  container="$(db_container)"
  [ -n "$container" ] || { echo "Supabase database container not found"; exit 1; }

  echo "Applying base schema..."
  psql_file "$container" "$REPO_ROOT/supabase/schema.sql" >/dev/null 2>&1 || true

  # One migration procedure, shared with staging and production. It records
  # what it applied, refuses a file that changed after being applied, and skips
  # only the four legacy migrations it knows by name — never "it failed, carry
  # on", which is how an absent schema used to make the isolation tests pass.
  echo "Applying migrations..."
  if ! "$REPO_ROOT/scripts/migrate.sh" apply local; then
    echo
    echo "Migrations failed. Stopping: an absent schema would make the isolation"
    echo "tests pass without proving anything."
    exit 1
  fi

  # Tables created through psql as `postgres` do not inherit the API grants that
  # the Supabase dashboard applies, so PostgREST would answer 403.
  echo "Granting API roles..."
  docker exec -i "$container" psql -q -U postgres -d postgres >/dev/null <<'SQL'
grant usage on schema public to anon, authenticated, service_role;
grant all privileges on all tables in schema public to anon, authenticated, service_role;
grant all privileges on all sequences in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
notify pgrst, 'reload schema';
SQL

  echo
  echo "Local Supabase ready at http://127.0.0.1:54321"
  echo "Run the integration suite with:  ./scripts/dev-supabase.sh test"
}

cmd_test() {
  require supabase
  cd "$WORKDIR"
  local status key anon
  status="$(supabase status --output json)"
  key="$(printf '%s' "$status" | python3 -c 'import json,sys; print(json.load(sys.stdin)["SERVICE_ROLE_KEY"])')"
  anon="$(printf '%s' "$status" | python3 -c 'import json,sys; print(json.load(sys.stdin)["ANON_KEY"])')"
  cd "$REPO_ROOT/backend"
  SUPABASE_TEST_URL=http://127.0.0.1:54321 \
  SUPABASE_TEST_SERVICE_KEY="$key" \
  SUPABASE_TEST_ANON_KEY="$anon" \
    npx vitest run src/__tests__/catalog-store.integration.test.ts
}

cmd_stop() {
  cd "$WORKDIR" 2>/dev/null || { echo "Nothing to stop."; exit 0; }
  supabase stop --no-backup
}

case "${1:-start}" in
  start) cmd_start ;;
  test)  cmd_test ;;
  stop)  cmd_stop ;;
  *) echo "Usage: $0 {start|test|stop}"; exit 1 ;;
esac
