-- Columns the OAuth callback has always written but no migration ever created.
--
-- `app_client_id` and `refresh_token` exist in the production database — they
-- were added by hand — so every environment rebuilt from `supabase/migrations`
-- (dev, CI, a future restore) was missing them and OAuth failed with
-- "Could not find the 'app_client_id' column of 'shopify_connections'".
--
-- Idempotent on purpose: production already has both.

ALTER TABLE shopify_connections
  ADD COLUMN IF NOT EXISTS app_client_id text,
  ADD COLUMN IF NOT EXISTS refresh_token text;

COMMENT ON COLUMN shopify_connections.app_client_id IS
  'Client ID of the Shopify app this token belongs to. Lets reconnect pick the same app the merchant installed.';
COMMENT ON COLUMN shopify_connections.refresh_token IS
  'Refresh token for online/expiring access tokens. NULL for offline tokens, which do not expire.';
