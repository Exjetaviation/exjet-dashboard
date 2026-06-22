-- 018_quoting_revamp.sql — Quoting → Dispatch revamp.
-- Apply manually in the Supabase SQL editor. Idempotent (IF NOT EXISTS).

-- Rate cards: owner vs charter per tail.
ALTER TABLE rate_cards ADD COLUMN IF NOT EXISTS label   text;
ALTER TABLE rate_cards ADD COLUMN IF NOT EXISTS purpose text;  -- 'owner' | 'charter' | null (default)

-- Native trip: company/contact, dispatch checklist, booked-by stamp.
ALTER TABLE scheduling_trips ADD COLUMN IF NOT EXISTS company_name text;
ALTER TABLE scheduling_trips ADD COLUMN IF NOT EXISTS contact      jsonb;       -- { name, email, phone }
ALTER TABLE scheduling_trips ADD COLUMN IF NOT EXISTS checklist    jsonb;       -- { contractReceived, paymentReceived, paymentProcessed }
ALTER TABLE scheduling_trips ADD COLUMN IF NOT EXISTS booked_by    text;
ALTER TABLE scheduling_trips ADD COLUMN IF NOT EXISTS booked_at    timestamptz;

-- FBO directory (bulk-imported from LevelFlight in a later phase).
CREATE TABLE IF NOT EXISTS airport_fbos (
  fbo_id    text PRIMARY KEY,
  icao      text NOT NULL,
  name      text,
  address   jsonb,
  lat       numeric,
  lng       numeric,
  phones    jsonb,
  fax       text,
  email     text,
  website   text,
  comms     jsonb,
  hours     text,
  raw       jsonb,
  synced_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS airport_fbos_icao_idx ON airport_fbos (icao);
