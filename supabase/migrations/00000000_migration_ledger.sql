-- ============================================================
-- Migration ledger
--
-- Nothing recorded which migrations a database had received, so applying them
-- was a matter of memory. This table is the record, and it is what makes
-- `scripts/migrate.sh` able to skip what is already applied and refuse when a
-- file has changed since it was.
--
-- Named to sort first so it always exists before anything consults it.
-- ============================================================

create table if not exists public.schema_migrations (
  filename      text primary key,
  checksum      text not null,
  applied_at    timestamptz not null default now(),
  applied_by    text
);

alter table public.schema_migrations enable row level security;
