-- Alerts table for Sillages intelligence alerts
create table if not exists alerts (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  type        text not null,           -- e.g. 'TRAFFIC_NOT_CONVERTING'
  title       text not null,
  message     text not null,
  severity    text not null default 'warning', -- 'warning' | 'positive'
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

create index if not exists alerts_account_id_read_at on alerts(account_id, read_at);

-- RLS
alter table alerts enable row level security;

create policy "Users can read their own alerts"
  on alerts for select
  using (account_id = (select id from accounts where user_id = auth.uid()));

create policy "Users can update their own alerts"
  on alerts for update
  using (account_id = (select id from accounts where user_id = auth.uid()));
