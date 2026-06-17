-- 006_adsb_positions.sql
-- Persisted ADS-B position history for the fleet map. Written by the always-on
-- recorder (src/services/adsbRecorder.js) every ~20s, independent of any client.
-- Used to reconstruct previous flights' real flown paths. Pruned to a rolling
-- window (default 90 days) by the recorder. Soft-fails if Supabase is absent.

create table if not exists public.adsb_positions (
    id           bigint generated always as identity primary key,
    registration text             not null,
    lat          double precision not null,
    lon          double precision not null,
    altitude_ft  integer,
    on_ground    boolean          not null default false,
    t            timestamptz      not null
);

create index if not exists adsb_positions_reg_t_idx
    on public.adsb_positions (registration, t);
