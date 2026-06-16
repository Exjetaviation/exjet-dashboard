-- 005_ntsb_accidents.sql
-- NTSB national accident/incident database, imported from the Access "avall.mdb"
-- by scripts/importNtsb.js (run manually; quarterly refresh). Two tables:
--
--   ntsb_raw                — one row per airplane involved. Reference only;
--                             the agent NEVER queries this (token-heavy).
--   ntsb_airport_profiles   — one PRE-AGGREGATED row per airport, computed at
--                             import time. This is the ONLY table the tool
--                             (get_ntsb_accident_history) reads: flat, tiny,
--                             already summarized — keeps the agent response
--                             under ~500 tokens.
--
-- Coded NTSB values are decoded to readable text at import time. Situational
-- awareness only — never a go/no-go gate.

create table if not exists public.ntsb_raw (
    ntsb_number           text primary key,
    event_date            date,
    airport_code          text,
    airport_name          text,
    make                  text,
    model                 text,
    aircraft_category     text,
    number_of_engines     integer,
    engine_type           text,
    injury_severity       text,
    aircraft_damage       text,
    weather_condition     text,
    broad_phase_of_flight text,
    narrative             text,
    probable_cause        text,
    latitude              text,
    longitude             text,
    state                 text,
    city                  text,
    imported_at           timestamptz not null default now()
);

create index if not exists ntsb_raw_airport_code_idx on public.ntsb_raw (airport_code);

create table if not exists public.ntsb_airport_profiles (
    airport_code            text primary key,
    airport_name            text,
    state                   text,
    total_events            integer not null default 0,
    fatal_events            integer not null default 0,
    part135_relevant_events integer not null default 0,
    top_phases              text[]  not null default '{}',
    top_weather_conditions  text[]  not null default '{}',
    top_damage_patterns     text[]  not null default '{}',
    recent_events           jsonb   not null default '[]'::jsonb,
    pattern_warnings        text[]  not null default '{}',
    last_event_date         date,
    data_through            date,
    updated_at              timestamptz not null default now()
);

create index if not exists ntsb_airport_profiles_state_idx on public.ntsb_airport_profiles (state);
