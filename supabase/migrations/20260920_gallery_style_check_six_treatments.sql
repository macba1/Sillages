-- The three new treatments could never be saved.
--
-- The layouts release added `soft`, `vintage` and `flash` everywhere except
-- here: `gallery_configs_style_check` still listed only the three treatments
-- that shipped first. Choosing one of the new ones in the admin sent a valid
-- request, hit the constraint, and came back as a 500 — so the radio snapped
-- back to the previous choice with no explanation, and the difference Growth
-- advertises ("all six treatments") could not be bought.
--
-- Widening a check constraint accepts more than before and rejects nothing
-- that was already stored, so every existing row stays valid.

alter table public.gallery_configs drop constraint if exists gallery_configs_style_check;

alter table public.gallery_configs add constraint gallery_configs_style_check check (style in ('original', 'warm', 'film', 'soft', 'vintage', 'flash'));
