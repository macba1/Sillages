-- Add comms_approval column to accounts
-- 'manual' = admin must approve all comms before they go out
-- 'auto' = system sends automatically
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS comms_approval text DEFAULT 'manual';
