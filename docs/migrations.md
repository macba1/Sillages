# Applying database migrations

There is one procedure, `scripts/migrate.sh`, and it is the same for a local
database, staging and production. **Nothing runs it automatically** — not CI,
not `deploy.sh`, not the server at start. Applying migrations to production is a
deliberate act by a person who has read the plan.

## Why it exists

Nothing recorded which migrations a database had received, so applying them was
a matter of memory. Two things went wrong because of that: the aggregate
functions the Performance screen depends on were added with no way to get them
into a deployed database, and a helper that reported a failed migration as a
benign skip made an absent schema look like a passing test suite.

## How it fails closed

| Guard | What it prevents |
|---|---|
| No default target | Running against something you did not name |
| `SILLAGES_DB_URL` supplied at run time, never committed | A connection string in the repository |
| `SILLAGES_MIGRATE_CONFIRM` must equal the target | A production run by autocomplete |
| A ledger of what was applied, with checksums | Re-running, and silently diverging from an edited file |
| Stops at the first failure | A half-applied schema continuing into the next migration |
| Legacy migrations skipped **by name** | "It failed, carry on" |

## Usage

```bash
./scripts/migrate.sh status local     # what this database already has
./scripts/migrate.sh plan   local     # what would be applied; touches nothing
./scripts/migrate.sh apply  local     # apply it

SILLAGES_DB_URL='postgresql://...' \
SILLAGES_MIGRATE_CONFIRM=staging \
  ./scripts/migrate.sh apply staging
```

`./scripts/dev-supabase.sh start` calls `apply local` itself, so the local
database and a deployed one are brought up by the same code path.

## Before deploying

1. `./scripts/migrate.sh plan <target>` — read the list.
2. Take a snapshot of the target database.
3. `SILLAGES_MIGRATE_CONFIRM=<target> ./scripts/migrate.sh apply <target>`.
4. Deploy the application.

In that order. The application tolerates a database that is behind — the
Performance panel degrades to an approximate count rather than failing — but not
one that is ahead.

## The five legacy migrations

`20260317_audit_fixes`, `20260409_subscription_plans`, `20260414_woocommerce_mvp`,
`20260603_brief_delivery` and `20260603_content_engine` cannot apply to a
database built from this repository alone: they depend on tables (`email_log`,
`leads`, and each other) created ad hoc in production years ago. They are
recorded in the ledger without being executed, so a fresh database is honest
about not having them rather than pretending they failed for an unknown reason.

They are skipped **by name**. A migration failing for any other reason stops the
run.

## Validating the branch

`./scripts/validate.sh` runs everything CI runs, in the same order, plus the
integration suite against a real database:

```
Backend    lint · type check · unit tests · build
Frontend   lint · type check · tests · build in both product modes
Integration  local database up, migrations applied · 25 tests
```

It refuses to report success if the integration suite skipped. `--quick` omits
it and says, in as many words, that the branch is therefore not validated.
