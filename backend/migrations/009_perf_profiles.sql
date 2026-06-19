-- Auto-recalibrated flight-time profile per aircraft type (cruise kt + fixed buffer).
create table if not exists scheduling_perf_profiles (
  aircraft_type text primary key,
  cruise_kt   numeric not null,
  buffer_min  numeric not null,
  n_legs      integer not null default 0,
  r2          numeric,
  updated_at  timestamptz not null default now()
);
