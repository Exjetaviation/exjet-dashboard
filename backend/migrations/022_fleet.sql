-- 022_fleet.sql — Fleet: aircraft profiles, components, time ledger, pilot flight info.
-- Idempotent. Apply manually in the Supabase SQL editor.

create table if not exists aircraft (
  id uuid primary key default gen_random_uuid(),
  tail text not null unique,
  lf_aircraft_oid text unique,
  origin text not null default 'manual' check (origin in ('levelflight','manual')),
  active boolean not null default true,
  serial text, color text, call_sign text, cbp_decal_number text,
  year int, amenities text, base_icao text, fbo_name text,
  is_91_only boolean, owner_company text, foreflight_enabled boolean,
  pax_seats int, aircraft_type text, engines_count int,
  cruise_speed_kt numeric, fuel_burn_1_lbs numeric, fuel_burn_2_lbs numeric, fuel_burn_3_lbs numeric,
  max_altitude_ft numeric, max_landing_weight_lbs numeric, min_landing_distance_ft numeric,
  max_gross_takeoff_weight_lbs numeric, max_fuel_capacity_lbs numeric,
  lf_synced_snapshot jsonb, synced_at timestamptz, locally_modified boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists aircraft_components (
  id uuid primary key default gen_random_uuid(),
  aircraft_id uuid not null references aircraft(id) on delete cascade,
  lf_component_oid text unique,
  component_type text not null check (component_type in ('engine','apu','airframe')),
  position text not null,
  serial text, model text, manufacturer text, note text,
  baseline_hours numeric not null default 0,
  baseline_cycles int not null default 0,
  baseline_at timestamptz not null default now(),
  total_hours numeric not null default 0,
  total_cycles int not null default 0,
  apu_last_reading int,
  accrues_flight_time boolean not null default true,
  tracks_cycles boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_components_aircraft on aircraft_components(aircraft_id);

create table if not exists component_time_entries (
  id uuid primary key default gen_random_uuid(),
  component_id uuid not null references aircraft_components(id) on delete cascade,
  source text not null check (source in ('baseline','flight_info','manual','adjustment')),
  leg_id uuid,
  hours_delta numeric not null default 0,
  cycles_delta int not null default 0,
  time_source text,
  note text, created_by text,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_entry_component_leg
  on component_time_entries(component_id, leg_id) where leg_id is not null;
create index if not exists idx_entries_component on component_time_entries(component_id);

create table if not exists flight_info (
  id uuid primary key default gen_random_uuid(),
  scheduling_leg_id uuid not null unique references scheduling_legs(id) on delete cascade,
  out_at timestamptz, off_at timestamptz, on_at timestamptz, in_at timestamptz,
  takeoff_tod text check (takeoff_tod in ('day','night')),
  landing_tod text check (landing_tod in ('day','night')),
  fuel_start_lbs numeric, fuel_stop_lbs numeric,
  apu_start numeric, apu_stop numeric, apu_end_cycles int,
  engine_1_oil_pints numeric, engine_2_oil_pints numeric,
  delay_reason text,
  approach_type text check (approach_type in ('precision','non_precision','visual')),
  debrief jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','complete')),
  completed_at timestamptz, completed_by text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists flight_info_crew (
  id uuid primary key default gen_random_uuid(),
  flight_info_id uuid not null references flight_info(id) on delete cascade,
  crew_lf_oid text, role text check (role in ('PIC','SIC')),
  performed_takeoff boolean, performed_landing boolean,
  imc_hours numeric, night_hours numeric
);
create index if not exists idx_ficrew_flight_info on flight_info_crew(flight_info_id);
