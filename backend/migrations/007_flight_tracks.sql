-- 007_flight_tracks.sql
-- Permanent per-flight ADS-B track snapshots for the flight detail map. Written
-- once per completed flight by the reconciler (src/services/flightTrackReconciler.js),
-- keyed by the LevelFlight leg id. NEVER pruned — this is the system of record for
-- historical flight paths (the raw adsb_positions firehose is the source, and it
-- prunes to a short rolling window). Soft-fails if Supabase is absent.

create table if not exists public.flight_tracks (
    leg_id        text primary key,
    registration  text not null,
    from_airport  text,
    to_airport    text,
    dep_time      timestamptz,
    arr_time      timestamptz,
    track         jsonb not null default '[]'::jsonb,  -- [[lat,lon], ...]
    point_count   integer not null default 0,
    created_at    timestamptz not null default now()
);

create index if not exists flight_tracks_reg_idx on public.flight_tracks (registration);
