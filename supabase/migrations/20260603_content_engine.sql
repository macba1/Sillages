-- ════════════════════════════════════════════════════════════════════════════
-- Content engine — 2026-06-03
-- APPLY MANUALLY in the Supabase SQL editor.
--
--   1. leads.instagram_handle — column the leads Pain Detector already writes
--      to but that never existed, so handles were silently dropped.
--   2. content_posts — one Instagram post per day (image or reel) published via
--      Postiz. Idempotent on post_date.
--   3. content_queue — manual reel uploads (HeyGen avatar) waiting to publish.
--   4. content_dm_drafts — generated DM drafts per lead (NEVER auto-sent).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. leads.instagram_handle ──────────────────────────────────────────────
ALTER TABLE leads ADD COLUMN IF NOT EXISTS instagram_handle text;

-- ── 2. content_posts ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_posts (
  id              uuid primary key default gen_random_uuid(),
  post_date       date not null,                 -- 1/day for the cron; seeds put 3/day
  slot_index      int  not null default 0,       -- 0 for daily; 0..2 for seed slots
  kind            text not null default 'image'  -- 'image' | 'reel'
                    check (kind in ('image','reel')),
  caption         text,
  image_url       text,
  source          text,                          -- 'lead_pattern' | 'evergreen' | 'reel'
  postiz_post_id  text,
  status          text not null default 'draft'  -- 'draft'|'seeded'|'scheduled'|'published'|'failed'
                    check (status in ('draft','seeded','scheduled','published','failed')),
  scheduled_for   timestamptz,
  error           text,
  created_at      timestamptz not null default now()
);

-- ── 3. content_queue (manual reels) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_queue (
  id            uuid primary key default gen_random_uuid(),
  video_url     text not null,                 -- Supabase storage / external URL
  caption       text,
  status        text not null default 'pending' -- 'pending'|'published'|'failed'
                  check (status in ('pending','published','failed')),
  published_at  timestamptz,
  content_post_id uuid references content_posts(id),
  created_at    timestamptz not null default now()
);

-- ── 4. content_dm_drafts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_dm_drafts (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid references leads(id),
  draft_date       date not null,
  instagram_handle text,
  shop_domain      text,
  draft_text       text not null,
  pain_tags        jsonb,
  status           text not null default 'pending' -- 'pending'|'sent'|'discarded'
                     check (status in ('pending','sent','discarded')),
  created_at       timestamptz not null default now(),
  unique (lead_id, draft_date)
);
