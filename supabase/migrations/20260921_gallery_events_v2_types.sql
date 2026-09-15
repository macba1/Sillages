-- Six of the events the product emits were rejected by the database.
--
-- The check constraint on `event_type` still listed the ten types that existed
-- before the second version of the gallery. Everything the new features
-- measure -- opening and finishing a story, creating a shared list, visiting
-- one, voting on it -- was refused on insert. Shared lists and votes were
-- written and read correctly; only the counting was lost, so Performance
-- showed zeroes for features that were working, and a storefront batch that
-- happened to contain a story event failed as a whole.
--
-- Widening a check accepts more than before and invalidates no existing row.

alter table public.gallery_events drop constraint if exists gallery_events_event_type_check;

alter table public.gallery_events add constraint gallery_events_event_type_check check (event_type in ('gallery_view', 'post_view', 'post_open', 'variant_select', 'save', 'unsave', 'share', 'add_to_cart', 'story_open', 'story_close', 'picks_created', 'picks_vote_created', 'picks_visit', 'friend_vote', 'checkout_started', 'purchase'));
