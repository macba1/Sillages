-- Brief feedback table
create table if not exists brief_feedback (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references intelligence_briefs(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  rating text not null check (rating in ('useful', 'not_useful', 'want_more')),
  want_more_topic text check (want_more_topic in ('customers', 'social_media', 'products', 'competition')),
  free_text text,
  created_at timestamptz not null default now()
);

-- One feedback per brief per account
create unique index if not exists brief_feedback_brief_account
  on brief_feedback (brief_id, account_id);

-- Index for querying recent feedback by account
create index if not exists brief_feedback_account_created
  on brief_feedback (account_id, created_at desc);

-- RLS
alter table brief_feedback enable row level security;

create policy "Users can insert own feedback"
  on brief_feedback for insert
  with check (account_id = auth.uid());

create policy "Users can read own feedback"
  on brief_feedback for select
  using (account_id = auth.uid());
