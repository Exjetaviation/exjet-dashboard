-- 008_scheduling.sql
-- Schema for the new Scheduling module (replaces LevelFlight scheduling).
-- During the transition the new system mirrors LevelFlight one-way (read only)
-- and ALSO allows native create/edit. Every operational row therefore carries
-- provenance:
--   origin              'levelflight' (mirrored) | 'native' (created here)
--   lf_oid              LevelFlight ObjectId for mirrored rows (null if native)
--   lf_synced_snapshot  frozen copy of LevelFlight's version, used by "Revert"
--   locally_modified    true once a user edits a mirrored row's working copy
--   upstream_changed    true when LevelFlight changes a row the user has edited
--   synced_at           last time the sync touched this row
-- The sync NEVER overwrites a locally_modified working copy (see reconcile.js).

-- TRIPS — one object across the lifecycle; status carries quote/hold/booked/cancelled.
create table if not exists public.scheduling_trips (
    id                 uuid primary key default gen_random_uuid(),
    lf_oid             text unique,
    status             text not null default 'quote',
    trip_number        text,
    quote_number       text,
    purpose            text,
    customer_lf_oid    text,
    company_lf_oid     text,
    aircraft_lf_oid    text,
    rate_name          text,
    pricing            jsonb,
    pax_notes          text,
    crew_notes         text,
    origin             text not null default 'native' check (origin in ('levelflight', 'native')),
    lf_synced_snapshot jsonb,
    locally_modified   boolean not null default false,
    upstream_changed   boolean not null default false,
    synced_at          timestamptz,
    modified_by        text,
    modified_at        timestamptz,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);
create index if not exists scheduling_trips_status_idx on public.scheduling_trips (status);

-- LEGS — belong to a trip.
create table if not exists public.scheduling_legs (
    id                 uuid primary key default gen_random_uuid(),
    trip_id            uuid not null references public.scheduling_trips(id) on delete cascade,
    lf_oid             text unique,
    seq                integer not null default 0,
    dep_icao           text,
    arr_icao           text,
    dep_time           timestamptz,
    arr_time           timestamptz,
    dep_fbo            text,
    arr_fbo            text,
    checklist          jsonb,
    origin             text not null default 'native' check (origin in ('levelflight', 'native')),
    lf_synced_snapshot jsonb,
    locally_modified   boolean not null default false,
    upstream_changed   boolean not null default false,
    synced_at          timestamptz,
    modified_by        text,
    modified_at        timestamptz,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);
create index if not exists scheduling_legs_trip_idx on public.scheduling_legs (trip_id);

-- CREW ASSIGNMENTS — per leg.
create table if not exists public.scheduling_crew_assignments (
    id                 uuid primary key default gen_random_uuid(),
    leg_id             uuid not null references public.scheduling_legs(id) on delete cascade,
    lf_oid             text unique,
    crew_lf_oid        text,
    seat               text,
    origin             text not null default 'native' check (origin in ('levelflight', 'native')),
    lf_synced_snapshot jsonb,
    locally_modified   boolean not null default false,
    upstream_changed   boolean not null default false,
    synced_at          timestamptz,
    modified_by        text,
    modified_at        timestamptz,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);
create index if not exists scheduling_crew_assignments_leg_idx on public.scheduling_crew_assignments (leg_id);

-- PASSENGERS — per trip.
create table if not exists public.scheduling_passengers (
    id                 uuid primary key default gen_random_uuid(),
    trip_id            uuid not null references public.scheduling_trips(id) on delete cascade,
    lf_oid             text unique,
    name               text,
    dob                date,
    weight_lbs         numeric,
    cargo_lbs          numeric,
    tsa_status         text,
    note               text,
    origin             text not null default 'native' check (origin in ('levelflight', 'native')),
    lf_synced_snapshot jsonb,
    locally_modified   boolean not null default false,
    upstream_changed   boolean not null default false,
    synced_at          timestamptz,
    modified_by        text,
    modified_at        timestamptz,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);
create index if not exists scheduling_passengers_trip_idx on public.scheduling_passengers (trip_id);

-- SYNC STATUS — one row per synced entity, drives the "Synced N min ago" UI.
create table if not exists public.scheduling_sync_status (
    entity          text primary key,
    last_run_at     timestamptz,
    last_success_at timestamptz,
    status          text,
    message         text,
    counts          jsonb
);
