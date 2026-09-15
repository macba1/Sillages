-- ============================================================
-- Layouts, filters, frames and the shareable card
--
-- Purely additive. Every column has a default that reproduces what a gallery
-- published before this migration already looked like:
--
--   layout           'grid'  — the only arrangement that existed
--   filter_intensity 100     — the filter exactly as it was drawn
--   frame            'none'  — no border was ever drawn
--   share_tagline    null    — falls back to the default words
--   hide_branding    false   — the Sillages mark was always shown
--
-- So no merchant's live storefront changes when this lands.
-- ============================================================

alter table public.gallery_configs
  add column if not exists layout text not null default 'grid',
  add column if not exists filter_intensity integer not null default 100,
  add column if not exists frame text not null default 'none',
  add column if not exists share_tagline text,
  add column if not exists hide_branding boolean not null default false;

-- Values are validated in the application as well; these stop a bad write from
-- another client putting a gallery into a state the storefront cannot render.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gallery_configs_layout_check') then
    alter table public.gallery_configs
      add constraint gallery_configs_layout_check
      check (layout in ('grid', 'polaroid', 'feed', 'stories'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'gallery_configs_frame_check') then
    alter table public.gallery_configs
      add constraint gallery_configs_frame_check
      check (frame in ('none', 'clean', 'polaroid', 'film', 'card'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'gallery_configs_intensity_check') then
    alter table public.gallery_configs
      add constraint gallery_configs_intensity_check
      check (filter_intensity between 0 and 100);
  end if;
end $$;

-- The style column predates this and is unconstrained on purpose: three more
-- filters are valid now, and a future one must not need a migration to be
-- rejected by the database before the application has shipped support for it.
