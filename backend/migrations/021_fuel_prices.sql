-- 021_fuel_prices.sql — vendor fuel-price ingestion (WFS + Everest CSVs).
-- Apply manually in the Supabase SQL editor. Idempotent.

CREATE TABLE IF NOT EXISTS fuel_prices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor         text NOT NULL,            -- 'wfs' | 'everest'
  icao           text NOT NULL,
  fbo_name       text,
  fbo_alt_name   text,
  fuel_type      text,
  tier_from_gal  numeric,
  tier_to_gal    numeric,
  price          numeric,
  taxes          numeric,
  total_price    numeric,
  currency       text DEFAULT 'USD',
  exp_date       date,
  city           text,
  country        text,
  notes          text,
  import_id      text,                     -- the gmail message id this batch came from
  source_file    text,
  effective_date date,
  imported_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fuel_prices_icao_idx     ON fuel_prices (icao);
CREATE INDEX IF NOT EXISTS fuel_prices_icao_fbo_idx ON fuel_prices (icao, fbo_name);
CREATE INDEX IF NOT EXISTS fuel_prices_vendor_idx   ON fuel_prices (vendor);

CREATE TABLE IF NOT EXISTS fuel_price_imports (
  gmail_message_id text PRIMARY KEY,
  vendor           text,
  file_name        text,
  rows_imported    int,
  effective_date   date,
  status           text,                   -- 'ok' | 'error'
  message          text,
  imported_at      timestamptz DEFAULT now()
);
