-- 019_quote_accept.sql — native quote "Request to Book" acceptance.
-- Apply manually in the Supabase SQL editor. Idempotent.
ALTER TABLE scheduling_trips ADD COLUMN IF NOT EXISTS accepted_at   timestamptz;
ALTER TABLE scheduling_trips ADD COLUMN IF NOT EXISTS accepted_note text;
