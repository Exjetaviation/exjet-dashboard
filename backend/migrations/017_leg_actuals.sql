-- 017_leg_actuals.sql
-- Actual departure/arrival per leg for the calendar's scheduled-vs-actual delay
-- overlay. Primary source is the LIVE ADS-B recorder (the same engine behind the
-- fleet-map status): it stamps actual_dep on a ground->air transition and actual_arr
-- on air->ground, the moment it observes them — full-stream, no movement gate. The
-- flight-track reconciler is a best-effort BACKFILL only: exact from on_ground
-- transitions when available, else approximate from the first/last airborne sample
-- (crowd-sourced ADS-B often misses the on-ground portion). `*_source` records which:
--   'live'  = recorder, real-time transition (most reliable)
--   'exact' = reconciler, ground/air transition in the stored firehose
--   'approx'= reconciler, first/last airborne sample (a few minutes off)
-- dep_time mirrors the SCHEDULED departure so the calendar can range-query like it
-- does flight_tracks. leg_id = the LevelFlight leg oid (the calendar's leg._id.$oid).

create table if not exists public.leg_actuals (
    leg_id          text primary key,
    registration    text,
    dep_time        timestamptz,   -- SCHEDULED departure (for range queries)
    actual_dep_time timestamptz,
    actual_arr_time timestamptz,
    dep_source      text,          -- 'live' | 'exact' | 'approx'
    arr_source      text,
    updated_at      timestamptz not null default now()
);

create index if not exists leg_actuals_dep_idx on public.leg_actuals (dep_time);

-- Supersedes migration 016's columns (the firehose-derivation approach) — now unused.
alter table public.flight_tracks
    drop column if exists actual_dep_time,
    drop column if exists actual_arr_time;
