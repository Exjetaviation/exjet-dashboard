-- 016_flight_track_actuals.sql
-- Actual departure/arrival times for each completed flight, derived by the
-- reconciler (src/services/flightTrackReconciler.js) from the firehose on_ground
-- transitions: actual_dep_time = first observed ground->air, actual_arr_time =
-- first air->ground after departure (~20s precision). Either may be NULL when no
-- clean transition was observed (e.g. logging started mid-air). Read by the
-- calendar's scheduled-vs-actual delay overlay via GET /api/adsb/actuals.

alter table public.flight_tracks
    add column if not exists actual_dep_time timestamptz,
    add column if not exists actual_arr_time timestamptz;
