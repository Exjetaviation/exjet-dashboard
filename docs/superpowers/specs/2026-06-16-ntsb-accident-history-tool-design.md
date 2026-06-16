# Tool #12 — `get_ntsb_accident_history` (NTSB national import)

**Date:** 2026-06-16
**Status:** Built

## Goal

Give the Operations Copilot recorded NTSB accident/incident history at an
airport as **situational awareness** (never a go/no-go gate), without ever
sending raw rows to Claude. Two tables: raw reference + a pre-aggregated
per-airport profile that the tool queries (keeps the response < ~500 tokens).

## Data source reality (differs from the original task)

`avall.zip` is the NTSB's **Microsoft Access** database (`avall.mdb`, 551 MB),
not a flat CSV — so **papaparse over one file doesn't apply directly**. It's
relational; the fields we need span several tables joined on `ev_id`
(+ `Aircraft_Key`):

- `events` — date, airport id (`ev_nr_apt_id`), name, city/state, lat/long,
  weather (`wx_cond_basic` = VMC/IMC), highest injury (`ev_highest_injury`)
- `aircraft` — make, model, category (`acft_category`='AIR'), `num_eng`,
  `damage`, `phase_flt_spec`
- `narratives` — `narr_cause` (probable cause), `narr_accf` (factual narrative)
- `engines` — `eng_type` (REC/TF/TP/TJ/TS…)
- data dictionary (`eADMSPUB_DataDictionary`) — phase code → meaning

Other corrections found during the build:
- **~31k events (2008–present), not 400k / 1982.** This export is the modern
  eADMS set.
- The `Occurrences` table is **empty**; phase comes from `aircraft.phase_flt_spec`
  (sparse, so `top_phases` is often empty — acceptable).
- `mdb-export -D` is ignored by this mdbtools build; dates (`MM/DD/YY`) are
  parsed to ISO in code (2-digit year split at 30).

## Architecture

**Read:** `mdb-export` (Homebrew mdbtools) streams each table → papaparse
(`step`) → in-memory join keyed by `ev_id`/`Aircraft_Key`. Codes decoded to
text. ~31k rows fits comfortably in memory.

**Write two tables (migration `005_ntsb_accidents.sql`):**
- `ntsb_raw` (PK `ntsb_number`) — one row per airplane; reference only, never
  queried by the agent.
- `ntsb_airport_profiles` (PK `airport_code`) — one pre-aggregated row per
  airport: counts, `top_phases`/`top_weather_conditions`/`top_damage_patterns`,
  `recent_events` (last 5 Part-135-relevant, JSONB), `pattern_warnings`,
  `last_event_date`, `data_through`.

## Components

- `backend/scripts/ntsbProfile.js` — **pure** decode + aggregation helpers
  (decode maps, `isLightGaPistonSingle`/`isPart135Relevant`, `broadPhase`,
  `eventDamagePatterns`, `topN`, `buildPatternWarnings`, `buildAirportProfile`).
  Unit-tested.
- `backend/scripts/importNtsb.js` — orchestration: extract zip / read mdb,
  stream+join, build raw rows + profiles, upsert (batches of 500). Flags:
  `--mdb`, `--zip`, `--dry-run`, `--airport KFLL` (prints one sample profile).
- `backend/src/agent/tools/getNtsbAccidentHistory.js` — tool. Resolves ICAO→FAA
  forms (KFLL→[KFLL,FLL]), reads `ntsb_airport_profiles` for those codes,
  returns the compact profile or `{ found: false }`.
- Wired into `tools/index.js` (`handlers`) + `tools/schemas.js`.
- `system_prompt_dispatch_v1.md` — names the live tool.

## Part-135 relevance

Exclude **only** a clear light-GA piston single — single engine AND
reciprocating AND a known light-GA make (Cessna/Piper/Cirrus/Beech/Mooney/…).
Turbine, multi-engine, unknown engine, or unknown make → kept (conservative).

## Damage patterns & warnings

`top_damage_patterns` scans `probable_cause` + `narrative` for keywords (runway
excursion, hard landing, CFIT/terrain, wind shear, icing, bird strike, fuel,
gear). `pattern_warnings` are human-readable, emitted only at 2+ (e.g.
"3 runway excursions recorded, 2 in IMC").

## Testing

- `node:test` unit tests: `ntsbProfile.test.js` (decode, GA filter, patterns,
  topN, warnings, full profile) and `getNtsbAccidentHistory.test.js`
  (ICAO forms). Run scoped: `node --test scripts/ntsbProfile.test.js src/agent`.
- Importer verified by `--dry-run` against the real `avall.mdb` (mapping,
  counts, sample profiles). Live tool query verified once data is imported.

## Manual steps (user)

1. Apply migration 005 in Supabase.
2. `brew install mdbtools` (done).
3. `node scripts/importNtsb.js --mdb <path>/avall.mdb --dry-run --airport KFLL`
   to sanity-check, then run without `--dry-run` to import.
