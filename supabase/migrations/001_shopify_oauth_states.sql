-- Migration 001: shopify_oauth_states
-- Replaces the in-memory pendingStates Map in routes/shopify.ts so that
-- OAuth nonces survive server restarts and multi-instance deployments.
--
-- Run against your live Supabase project:
--   psql $DATABASE_URL -f supabase/migrations/001_shopify_oauth_states.sql

create table if not exists public.shopify_oauth_states (
  state       text primary key,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  expires_at  timestamptz not null
);
