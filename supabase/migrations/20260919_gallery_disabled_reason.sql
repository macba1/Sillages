-- Why a gallery is off.
--
-- Upgrading a plan replaces the subscription: Shopify activates the new charge
-- and cancels the old one. When the cancellation webhook arrives first, the
-- shop looks -- for a moment -- like a shop with no plan, and the gallery is
-- switched off to stop serving a paid feature. The activation that follows put
-- the plan back but left the gallery dark, so a merchant who paid MORE ended up
-- with their storefront gallery turned off and no way to know why.
--
-- Recording who turned it off makes the difference recoverable: a gallery we
-- switched off because the plan lapsed goes back on by itself when the plan
-- returns, and one the merchant switched off stays off.
--
-- Additive and nullable: existing rows keep behaving exactly as before, and a
-- null reason on a disabled gallery is read as the merchant's own decision.

alter table public.gallery_configs
  add column if not exists disabled_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'gallery_configs_disabled_reason_check'
  ) then
    alter table public.gallery_configs
      add constraint gallery_configs_disabled_reason_check
      check (disabled_reason is null or disabled_reason in ('merchant', 'plan'));
  end if;
end $$;
