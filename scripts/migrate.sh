#!/usr/bin/env bash
#
# Applies database migrations, in order, exactly once.
#
# Fails closed. It will not touch a database unless every one of these is true:
#
#   - a target is named explicitly (there is no default);
#   - the target's connection string is supplied at run time, never read from a
#     committed file;
#   - for anything that is not local, SILLAGES_MIGRATE_CONFIRM matches the
#     target name, so a production run cannot happen by autocomplete;
#   - every migration already applied still has the checksum it was applied
#     with, so an edited file is caught rather than silently skipped.
#
# It is NEVER invoked automatically. Nothing in CI, in deploy.sh, or at server
# start calls it. Applying migrations to production is a deliberate act by a
# person who has read the plan.
#
#   ./scripts/migrate.sh plan   local
#   ./scripts/migrate.sh apply  local
#   SILLAGES_MIGRATE_CONFIRM=production ./scripts/migrate.sh apply production
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"

# Legacy migrations that cannot apply to a database built from this repository
# alone: they depend on tables created ad hoc in production years ago. They are
# skipped by name, never by "it failed, carry on".
LEGACY_SKIPS="20260317_audit_fixes.sql 20260409_subscription_plans.sql 20260414_woocommerce_mvp.sql 20260603_brief_delivery.sql 20260603_content_engine.sql"

usage() {
  cat <<'USAGE'
Usage: ./scripts/migrate.sh <plan|apply|status> <target>

  plan    Show what would be applied. Touches nothing.
  apply   Apply what is pending.
  status  Show what this database has already received.

Targets:
  local        The throwaway Supabase from ./scripts/dev-supabase.sh
  staging      Requires SILLAGES_DB_URL and SILLAGES_MIGRATE_CONFIRM=staging
  production   Requires SILLAGES_DB_URL and SILLAGES_MIGRATE_CONFIRM=production

The connection string is never read from a committed file. Export it for the
single command:

  SILLAGES_DB_URL='postgresql://...' \
  SILLAGES_MIGRATE_CONFIRM=staging \
    ./scripts/migrate.sh apply staging
USAGE
}

command="${1:-}"
target="${2:-}"

[ -n "$command" ] && [ -n "$target" ] || { usage; exit 2; }
case "$command" in plan|apply|status) ;; *) usage; exit 2 ;; esac

# ── Resolve the target, refusing anything ambiguous ──────────────────────────
case "$target" in
  local)
    container="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -m1 supabase_db_ || true)"
    if [ -z "$container" ]; then
      echo "No local Supabase is running. Start it with ./scripts/dev-supabase.sh start" >&2
      exit 1
    fi
    run_sql() { docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }
    run_file() { docker exec -i "$container" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres < "$1"; }
    ;;
  staging|production)
    if [ -z "${SILLAGES_DB_URL:-}" ]; then
      echo "SILLAGES_DB_URL is not set. Refusing to guess a $target database." >&2
      exit 1
    fi
    if [ "${SILLAGES_MIGRATE_CONFIRM:-}" != "$target" ]; then
      echo "Refusing to touch $target." >&2
      echo "Re-run with SILLAGES_MIGRATE_CONFIRM=$target if that is genuinely what you mean." >&2
      exit 1
    fi
    command -v psql >/dev/null || { echo "psql is required for a $target run." >&2; exit 1; }
    run_sql() { psql -v ON_ERROR_STOP=1 "$SILLAGES_DB_URL" "$@"; }
    run_file() { psql -q -v ON_ERROR_STOP=1 "$SILLAGES_DB_URL" -f "$1"; }
    ;;
  *)
    echo "Unknown target: $target" >&2
    usage
    exit 2
    ;;
esac

if [ "$command" = "apply" ] && [ "$target" = "production" ]; then
  echo "────────────────────────────────────────────────────────────"
  echo " Applying migrations to PRODUCTION."
  echo " This changes the live database used by real merchants."
  echo "────────────────────────────────────────────────────────────"
fi

checksum_of() { shasum -a 256 "$1" | awk '{print $1}'; }

# ── The ledger must exist before anything consults it ────────────────────────
ensure_ledger() {
  run_file "$MIGRATIONS_DIR/00000000_migration_ledger.sql" >/dev/null
}

applied_checksum() {
  run_sql -qAt -c "select checksum from public.schema_migrations where filename = '$1'" 2>/dev/null | head -1
}

record() {
  run_sql -q -c "insert into public.schema_migrations (filename, checksum, applied_by)
                 values ('$1', '$2', '${USER:-unknown}')
                 on conflict (filename) do update set checksum = excluded.checksum" >/dev/null
}

# ── Work out what is pending, and refuse if anything was edited ──────────────
ensure_ledger

pending=()
drift=()

for file in "$MIGRATIONS_DIR"/*.sql; do
  name="$(basename "$file")"
  [ "$name" = "00000000_migration_ledger.sql" ] && continue

  sum="$(checksum_of "$file")"
  seen="$(applied_checksum "$name")"

  if [ -z "$seen" ]; then
    pending+=("$name")
  elif [ "$seen" != "$sum" ]; then
    # An applied migration has been edited. Editing history is how a database
    # and a repository silently diverge, so this stops the run.
    drift+=("$name")
  fi
done

if [ "$command" = "status" ]; then
  echo "Applied:"
  run_sql -qAt -c "select filename || '  ' || to_char(applied_at, 'YYYY-MM-DD HH24:MI') from public.schema_migrations order by filename" | sed 's/^/  /'
  echo
  echo "Pending: ${#pending[@]}"
  for name in "${pending[@]:-}"; do [ -n "$name" ] && echo "  $name"; done
  exit 0
fi

if [ "${#drift[@]}" -gt 0 ]; then
  echo "These migrations were applied and have since been edited:" >&2
  for name in "${drift[@]}"; do echo "  $name" >&2; done
  echo >&2
  echo "A migration is a historical record. Add a new one instead of changing an" >&2
  echo "applied one; otherwise this database and this repository have quietly" >&2
  echo "diverged. Refusing to continue." >&2
  exit 1
fi

if [ "${#pending[@]}" -eq 0 ]; then
  echo "Nothing pending. $target is up to date."
  exit 0
fi

echo "Pending on $target (${#pending[@]}):"
for name in "${pending[@]}"; do
  if [[ " $LEGACY_SKIPS " == *" $name "* ]]; then
    echo "  $name   (legacy — will be recorded, not executed)"
  else
    echo "  $name"
  fi
done

if [ "$command" = "plan" ]; then
  echo
  echo "Nothing was applied. Re-run with 'apply' to execute the list above."
  exit 0
fi

echo
for name in "${pending[@]}"; do
  file="$MIGRATIONS_DIR/$name"
  sum="$(checksum_of "$file")"

  if [[ " $LEGACY_SKIPS " == *" $name "* ]]; then
    # These predate the ledger and describe state that already exists in
    # production. Recording them keeps the ledger honest without pretending we
    # can replay them.
    record "$name" "$sum"
    printf '  recorded  %s (legacy)\n' "$name"
    continue
  fi

  if run_file "$file" >/dev/null 2>&1; then
    record "$name" "$sum"
    printf '  applied   %s\n' "$name"
  else
    echo
    echo "  FAILED    $name" >&2
    echo >&2
    echo "Stopping. Nothing after this migration has been applied, and this one is" >&2
    echo "not recorded, so it will be retried on the next run once the cause is" >&2
    echo "fixed." >&2
    exit 1
  fi
done

echo
echo "Done. $target is up to date."
