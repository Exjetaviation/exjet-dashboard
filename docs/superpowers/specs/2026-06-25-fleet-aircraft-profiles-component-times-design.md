# Fleet — Aircraft Profiles, Components & Time-Tracking + Pilot Flight Info — Design

> **Status:** Draft for review · **Date:** 2026-06-25 · **Branch:** `feat/fleet-aircraft-profiles`
> **Related:** replaces static `backend/src/scheduling/fleet.js`; feeds the future "true cost-per-hour" quoting project; complements (does not touch) the in-flight quote/pricing work on `feat/pricing-slideout`.

## 1. Goal

Build a **Fleet** area in the dashboard with editable **aircraft profiles** imported from LevelFlight (LF), each plane's **components** (engines / APU / airframe), and **automatic component time-tracking** (running hours + cycles) that updates after every flight. The flight data comes from a new pilot-facing **Flight Info** (post-flight) page where crews enter OOOI times and other post-flight values — so the component-hours chain is owned end-to-end inside our app, not dependent on LF.

This is the first slice of a larger "own LF's Fleet module" effort. Later phases (deferred — see §13) add Records, Maintenance task tracking, Rates & Fees, Preferred Crew, FRAT/Risk Assessment, and Weight & Balance.

## 2. Background — what LF's Fleet module actually is (verified)

LF's Fleet module (`ops.levelflight.com/fleet`, API host `rest.levelflight.com`) has two areas:

**Per-aircraft profile** — 9 sections under `/fleet/aircraft/{id}/{section}`: Basic Info, Reports, Records, Performance, Maintenance, Time & Landings, Rates & Fees, Preferred Crew, iCal Links.
**Fleet-wide Components** — `/fleet/components`: every engine/APU across all tails.

Confirmed LF endpoints (captured from a real session + the existing probe report):
- `GET /api/aircraft/list` — fleet summary (`tailNumber, serial, type{name,engines}, airport, paxSeats, active, _id.$oid`)
- `GET /api/aircraft/{id}` — **full profile** in one object: basic info + performance (`cruiseSpeed`, `fuelBurns[]`, `limits{}`), component identity (`components.engines.{1,2}` + `apu` with `manufacturer/model/serial`), airframe `legacy{date,time,cycles}`, `year, color, owner, fbo, is91Only, paxSeats, foreflight, trackHobbs/trackOil`
- `GET /aircraft/erk/{id}` — Records (FAA checks / currency / documents) *(deferred phase)*
- `GET /api/components/all/true` — fleet-wide components list
- `GET /api/components/{id}` — single component detail
- `GET /api/aircraft/otherFlightTimes` — per-component current times (baseline source candidate)
- `/reports/*` — PDF reports *(deferred phase)*

The swagger (`Downloads/swagger-docs.yaml`) documents only `/api/aircraft/{list,all,{id}}` + the `/reports/*` PDFs; the per-section/component endpoints are undocumented (captured live). **LF exposes no aircraft/component write endpoint** — consistent with our one-way "never write back to LF" rule. So **editable profiles live entirely in our DB**.

### The Maintenance "Current Times" (the feature target)
Per component, LF tracks **Hours** (decimal), **Flight Log Time** (HH:MM, accrued from flight logs), and **Cycles**. Example (N69FP): Airframe 9546.2h / 5579c; Engine 1 9268.5h / 5409c; Engine 2 9316.7h / 5441c; APU 6904h / 0c. APU cycles are tracked separately (0 from flight logs).

### The Flight Info / Post-Flight page (the data source)
Within a Flight/Trip, the per-leg **Flight Info** tab has a **Post Flight** block where pilots enter:
- **OOOI**: Out / Off / On / In → computes **Actual Flight (On−Off)**, **Actual Block (In−Out)**, ETE; **Time of Day** (takeoff/landing day/night); **Mark Complete**
- **Fuel Start / Fuel Stop** (lbs); **APU Start / APU Stop / APU End Cycles**; **Engine #1/#2 Oil Added** (pints)
- **Delay Reason**, **Approach Type** (precision / non-precision / visual)
- **Per-pilot (PIC & SIC)**: Performed Takeoff (Y/N), Performed Landing (Y/N), IMC hrs, Night hrs
- **Debrief** (category Summary/Operations/Maintenance/Catering/Passenger + notes + SMS-event flag); **Attachments**
- (Also at the top of the tab: FRAT/Risk Assessment + Weight & Balance — **deferred**.)

**The time convention (confirmed with the user):** **block = Out→In** (pilot block/duty); **engine + airframe time = Off→On** (flight/air time); **APU time = APU Stop − APU Start**. Cycles = +1 per leg (one landing).

## 3. Scope

**In scope (this slice):**
1. **Aircraft profiles** — `aircraft` master table (replaces `fleet.js`), Basic Info + Performance, import from LF + manual add, fully editable.
2. **Components + time-tracking** — `aircraft_components` (engine/APU/airframe) with baseline + running totals; `component_time_entries` ledger; the accrual engine.
3. **Flight Info (post-flight core)** — `flight_info` + `flight_info_crew`; pilot entry tab in the trip detail; API-first so a future pilot mobile app reuses the same endpoints.

**Out of scope (deferred to later phases):** Records/airworthiness docs, Maintenance task tracking (Next Due / Task List), Rates & Fees, Preferred Crew, Reports/PDFs, iCal links, FRAT/Risk Assessment, Weight & Balance, per-leg component override ("Edit Components"), photo re-hosting.

## 4. Data model — migration `022` (applied manually in Supabase)

All tables soft-fail when absent (app convention) so code can deploy before the migration runs. Idempotent DDL (`IF NOT EXISTS`).

### `aircraft` — one row per plane (replaces `fleet.js`)
- Identity: `id` uuid PK, `tail` text UNIQUE, `lf_aircraft_oid` text UNIQUE NULL, `origin` (`levelflight`/`manual`), `active` bool
- Basic Info: `serial`, `color`, `call_sign`, `cbp_decal_number`, `year` int, `amenities` text, `base_icao`, `fbo_name`, `is_91_only` bool, `owner_company`, `foreflight_enabled` bool, `pax_seats` int, `aircraft_type` text, `engines_count` int
- Performance: `cruise_speed_kt`, `fuel_burn_1_lbs`, `fuel_burn_2_lbs`, `fuel_burn_3_lbs`, `max_altitude_ft`, `max_landing_weight_lbs`, `min_landing_distance_ft`, `max_gross_takeoff_weight_lbs`, `max_fuel_capacity_lbs` (all numeric)
- Sync safety (mirrors the trips pattern): `lf_synced_snapshot` jsonb, `synced_at`, `locally_modified` bool, `created_at`, `updated_at`

### `aircraft_components` — one row per engine / APU / airframe
- `id` uuid PK, `aircraft_id` uuid FK→aircraft CASCADE, `lf_component_oid` text UNIQUE NULL
- `component_type` (`engine`/`apu`/`airframe`), `position` (`engine_1`/`engine_2`/`apu`/`airframe`), `serial`, `model`, `manufacturer`, `note`
- Times: `baseline_hours` numeric, `baseline_cycles` int, `baseline_at` timestamptz, `total_hours` numeric, `total_cycles` int (= baseline + Σ ledger)
- Flags: `accrues_flight_time` bool (true for airframe+engines, **false for APU**), `tracks_cycles` bool (false for APU), `active` bool, timestamps
- Airframe is modeled as a component row (auto-created per aircraft) for a uniform accrual engine; it is hidden from the fleet-wide "Add Component" list (matching LF, where airframe is implicit).

### `component_time_entries` — the ledger (idempotency + audit)
- `id` uuid PK, `component_id` uuid FK→components CASCADE
- `source` (`baseline`/`flight_info`/`manual`/`adjustment`)
- `leg_id` uuid NULL (the `scheduling_legs.id` that produced it; null for `baseline`/`manual`/`adjustment`); **UNIQUE(component_id, leg_id)** — the double-apply guard
- `hours_delta` numeric, `cycles_delta` int, `time_source` (`crew`/`live`/`exact`/`approx`), `note`, `created_by`, `created_at`
- Component totals = `baseline_* + Σ(deltas)`, recomputed on every write.

### `flight_info` — one post-flight log per leg (`UNIQUE scheduling_leg_id`)
- `id` uuid PK, `scheduling_leg_id` uuid FK→scheduling_legs(id) CASCADE
- OOOI: `out_at`, `off_at`, `on_at`, `in_at` timestamptz → derived `flight_minutes` (On−Off), `block_minutes` (In−Out)
- `takeoff_tod` / `landing_tod` (`day`/`night`)
- Fuel: `fuel_start_lbs`, `fuel_stop_lbs`; APU: `apu_start`, `apu_stop`, `apu_end_cycles`; Oil: `engine_1_oil_pints`, `engine_2_oil_pints`
- `delay_reason`, `approach_type` (`precision`/`non_precision`/`visual`)
- `debrief` jsonb (`[{category, notes, sms_event}]`)
- `status` (`draft`/`complete`), `completed_at`, `completed_by`, timestamps
- Attachments reuse the existing private `scheduling-docs` bucket + `scheduling_documents` (linked by leg).

### `flight_info_crew` — PIC/SIC per-pilot entries
- `id` uuid PK, `flight_info_id` uuid FK CASCADE, `crew_lf_oid` text, `role` (`PIC`/`SIC`), `performed_takeoff` bool, `performed_landing` bool, `imc_hours` numeric, `night_hours` numeric

## 5. LevelFlight import

`fleet/lfAircraftImport.js` (pure mapper + soft-fail store). `POST /api/fleet/aircraft/import` pulls `GET /api/aircraft/list`, then `GET /api/aircraft/{id}` per plane (+ `/api/aircraft/otherFlightTimes` and/or `/api/components/all/true` for component baseline times), and upserts:
- `aircraft` rows (Basic Info + Performance from the LF object), `lf_aircraft_oid` set, `origin='levelflight'`.
- `aircraft_components` rows for each engine + APU (identity from `components.*`), plus an auto-created airframe component. Baseline hours/cycles seeded from LF current times (`legacy` for airframe; `otherFlightTimes`/component detail for engines/APU); `baseline_at = now`.
- A `baseline` ledger entry per component records the seeded value for auditability.
- **Re-import safety:** like trips, refresh refreshes `lf_synced_snapshot` + LF-sourced fields but respects `locally_modified` (never clobbers user edits). Re-import does **not** rewrite component baselines unless explicitly requested (avoids double-counting accrued hours).

> **Endpoint correction to make:** the existing prod `services/levelflight.js` `getAircraft()` calls `/api/aircraft/all` (the makes/models *catalog*). The fleet source is `/api/aircraft/list` (+ `/{id}`). Add the correct calls rather than reusing the misnamed one.

## 6. The accrual engine — `fleet/componentAccrual.js`

The pilot's completed Flight Info is the source of truth.

**Trigger:** (a) `POST …/flight-info/complete` fires accrual synchronously; (b) a best-effort backfill pass in the existing hourly `flightTrackReconciler` re-scans completed `flight_info` rows (so a missed/edited entry self-heals). Soft-fails if tables/Supabase absent.

**Per completed `flight_info`:**
1. Resolve the aircraft from the leg's tail (`dispatch.aircraft.tailNumber` → `normReg` on both sides). No match → skip.
2. For each **accruing** component (airframe + engines): upsert a ledger entry keyed `UNIQUE(component_id, leg_id)` with `hours_delta = flight_minutes/60` (Off→On), `cycles_delta = 1`, `time_source='crew'` (pilot-entered).
3. For the **APU** component: `hours_delta = apu_stop − apu_start`; `cycles_delta = apu_end_cycles − previous_apu_reading` (APU End Cycles is a **running total** — store the reading, accrue the delta).
4. Recompute `total_hours/total_cycles`.

**Correctness guards:**
- **Baseline-date filter:** only accrue legs whose flight completed *after* `baseline_at` — the imported LF baseline already contains historical hours, so this prevents double-counting.
- **Idempotent:** `UNIQUE(component_id, leg_id)` means re-runs/restarts never double-apply; editing a completed log updates the existing entry and recomputes.
- **Upgrade-aware:** if a leg's source values change (e.g. pre-fill air-time later corrected by the pilot), the entry's `hours_delta`/`time_source` update.

**ADS-B as pre-fill, not source:** when the form loads with no data, `leg_actuals` (or the LF `block{out,off,on,in}` on mirrored legs) pre-fills Out/Off/On/In so pilots aren't typing from scratch; their entry wins. Default: **accrual happens only on Mark Complete** (clean authoritative chain). (Optional later: accrue from `leg_actuals` for legs never logged by a pilot.)

**Manual entries:** APU time top-ups and post-maintenance corrections/resets go through the same ledger (`source='manual'`/`'adjustment'`, deltas may be negative), fully audited.

## 7. HTTP API surface

New router `routes/fleet.js` mounted `/api/fleet` (auth-guarded; mutations gated for scheduling editors). Flight Info is a leg-scoped resource (clean for the future mobile app).

**Aircraft / components**
- `GET /api/fleet/aircraft` · `GET /api/fleet/aircraft/:idOrTail` (+ components)
- `POST /api/fleet/aircraft` · `PATCH /api/fleet/aircraft/:id` (Basic Info + Performance; sets `locally_modified`) · soft `DELETE /api/fleet/aircraft/:id`
- `POST /api/fleet/aircraft/import` (pull/refresh from LF)
- `GET /api/fleet/components` (fleet-wide + current times) · `POST /api/fleet/aircraft/:id/components` · `PATCH/DELETE /api/fleet/components/:id`
- `GET /api/fleet/components/:id/ledger` · `POST /api/fleet/components/:id/entries` (manual APU time / adjustment)

**Flight Info** (web tab now, mobile app later — same endpoints)
- `GET /api/scheduling/legs/:legId/flight-info` (pre-filled from `leg_actuals`/LF `block` if none)
- `PUT /api/scheduling/legs/:legId/flight-info` (upsert draft)
- `POST /api/scheduling/legs/:legId/flight-info/complete` (Mark Complete → accrual)

**Backend services:** `fleet/aircraftStore.js`, `fleet/componentStore.js` (+ `recomputeTotals`), `fleet/lfAircraftImport.js`, `fleet/componentAccrual.js`, `scheduling/flightInfoStore.js`. Stores soft-fail; mappers are pure + unit-tested.

## 8. Permissions

Flight Info writes need a new guard: allow **scheduling editors OR the crew assigned to that leg** (pilots are otherwise read-only). Resolve assignment via the leg's crew snapshot (seats 2/3/7) matched to `req.user.email`/oid. Fleet aircraft/component mutations stay under `requireSchedulingEditor`.

## 9. Frontend

- **Fleet area** — new `/fleet/*` shell mirroring LF: `/fleet/aircraft` (list), `/fleet/aircraft/:tail` (profile with **Basic Info · Performance · Components** sub-nav — only in-scope sections), `/fleet/components` (fleet-wide list + current times + Add Component + manual time entry). Edit forms; Add Component modal; component ledger view.
- **Flight Info tab** — `FlightInfoTab.jsx`, registered as one tab in `SchedulingTripDetail.jsx` (single-line shared edit to minimize collision with the other agent). Per-leg post-flight form: OOOI (pre-filled), fuel, APU, oil, time-of-day, delay/approach, PIC/SIC info, debrief, attachments, Mark Complete. Built mobile-friendly for the future pilot app.
- Conventions: inline styles + CSS vars, force-dark, matching existing pages. `lib/flightTime.js` util (HH:MM ↔ decimal) with a `node:test`.

## 10. Testing

Native `node:test`, next to source:
- `fleet/componentAccrual.test.js` — accrual math, **idempotency** (same leg twice → one entry), air→crew **upgrade**, **baseline-date filter**, APU start/stop.
- `fleet/lfAircraftImport.test.js` — real captured LF aircraft/component shapes → rows; `locally_modified` respected on re-import.
- `scheduling/flightInfo*.test.js` — OOOI → flight/block minutes; LF `block` pre-fill mapping.
- store soft-fail tests; frontend `lib/flightTime.test.js`.
- Migration `022` idempotent; verify build (`cd frontend && npm run build`).

## 11. Rollout

- Migration `022_fleet.sql` applied manually in the Supabase SQL editor (ask the user to run it). Code soft-fails until applied.
- LF import is on-demand (`POST /api/fleet/aircraft/import`); no new always-on worker beyond the reconciler backfill pass (which no-ops if tables absent).
- Update **`CLAUDE.md`** in the same change: new tables (§18), `/api/fleet` + flight-info routes (§19), the reconciler accrual pass (§9/§17), Fleet pages (§20), `fleet.js` → DB note (§6), migration `022` (§3).

## 12. Resolved decisions (was: open questions)

1. **Airframe accrual basis** — **Off→On (flight time)**, same as engines (block In−Out is still recorded for pilot duty/logbook).
2. **APU End Cycles** — it is a **running total**; `cycles_delta = apu_end_cycles − previous reading`. We persist the last reading per APU component to compute the delta.
3. **Baseline times** — **auto-import from LF** (`otherFlightTimes` / aircraft `legacy` / component detail) as the seed; any value LF doesn't provide stays editable for maintenance to enter manually.

Remaining empirical check (resolve during the import build, non-blocking): confirm exactly which LF endpoint returns per-component current hours/cycles cleanly (`/api/aircraft/otherFlightTimes` vs component detail).

## 13. Future phases (separate specs)

Records (airworthiness docs + expiry alerts) → Maintenance task tracking (Next Due / Task List, ATA codes) → Rates & Fees (ties to quoting) → Preferred Crew (ties to crew assignment) → FRAT/Risk Assessment → Weight & Balance → Reports/PDFs → pilot mobile app (reuses the Flight Info API).
