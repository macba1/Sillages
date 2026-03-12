-- Token recovery system: track failing tokens with graduated retry
ALTER TABLE shopify_connections ADD COLUMN IF NOT EXISTS token_status text DEFAULT 'active';
ALTER TABLE shopify_connections ADD COLUMN IF NOT EXISTS token_failing_since timestamptz;
ALTER TABLE shopify_connections ADD COLUMN IF NOT EXISTS token_retry_count integer DEFAULT 0;
