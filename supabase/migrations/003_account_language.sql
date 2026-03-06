-- Add language preference to accounts
alter table accounts
  add column if not exists language text not null default 'en'
    check (language in ('en', 'es'));
