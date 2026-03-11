-- Add missing section_upcoming column to intelligence_briefs
-- Run this in the Supabase Dashboard SQL Editor
ALTER TABLE intelligence_briefs ADD COLUMN IF NOT EXISTS section_upcoming jsonb DEFAULT null;
