# Quote Engine — Design Spec

**Date:** 2026-06-19
**Status:** Approved (design); ready for implementation plan
**Context:** Part of the LevelFlight scheduling rebuild inside `exjet-dashboard`. Adds native quote pricing to the new Scheduling section so quotes can be created, priced, and booked without LevelFlight — surviving the eventual cutover.

---

## Goal

When a quote (native trip at the `quote` stage) is created or edited, compute each leg's **distance** and **flight time**, price the trip from the operator's **Rate Cards**, and store a line-item breakdown on the trip — reproducing LevelFlight's quote numbers but running entirely in our system.

## Key finding (why this is tractable)

LevelFlight's flight-time math is not magic. Regressing 52 of our own completed legs (LevelFlight's computed `distance_nm` vs `flight_mins`, from `pricing_history`) recovers its formula at **R² = 0.973**:

```
flight_minutes ≈ 14.2 + (distance_nm ÷ 452 kt × 60)      # Gulfstream GIV-SP
```

So LevelFlight computes **great-circle distance ÷ ~452 kt effective cruise + ~14 min climb/descent overhead**, per aircraft type. Both Exjet tails are GIV-SPs, so one profile covers the fleet today. We reproduce this with our own data and let it **auto-recalibrate** as more legs accumulate.

## Architecture

A pricing pass runs on quote create/edit:

```
leg (dep_icao, arr_icao, pax)
   │
   ▼
[1] Distance  ── haversine(airportCoord(dep), airportCoord(arr)) → nm
   │
   ▼
[2] Flight time ── history override (avg actual block on this exact pair+type)
   │                else estimate: buffer + distance ÷ cruise   (per-type profile)
   ▼
[3] Pricing  ── rate card for the tail → flight cost + min-hours/short-leg
   │            + overnight + segment fee + FET                  (existing formula)
   ▼
breakdown JSON  →  scheduling_trips.pricing   →  shown on quote/trip page
```

The **aircraft performance profile** (cruise kt, buffer min) used in [2] is recomputed periodically from completed legs (auto-recalibration), not hard-coded.

## Components

### 1. Airport coordinates (`backend/src/scheduling/airports.js` + data file)
- Bundle a static ICAO → `{lat, lng}` table derived from the public-domain **OurAirports** dataset, trimmed to entries with an ICAO ident. Stored as a JSON asset in the repo (no external dependency, no network call).
- `airportCoord(icao)` → `{lat, lng}` | `null`. Case-insensitive, trims input.
- Tested with a handful of known fields (KFXE, KTEB, KMIA…).

### 2. Distance (`backend/src/scheduling/distance.js`)
- `greatCircleNm(a, b)` — haversine, Earth radius 3440.065 nm, returns nautical miles.
- Pure, fully unit-tested against known pairs (e.g. KFXE–KTEB ≈ known nm).
- A configurable `ROUTING_FACTOR` (default `1.0`; great-circle matched LevelFlight closely) left as a single constant so we can pad later if calibration shows LF distances run a few percent high.

### 3. Aircraft performance profile + auto-recalibration (`backend/src/scheduling/perfProfile.js`)
- **Storage:** new table `scheduling_perf_profiles` — `aircraft_type text pk`, `cruise_kt numeric`, `buffer_min numeric`, `n_legs int`, `r2 numeric`, `updated_at timestamptz`. (Migration 009.)
- **Calibration:** `calibratePerfProfiles()` —
  - Pull completed legs with a known airport pair + actual flight minutes. Source today = `pricing_history` (LevelFlight-derived); after cutover, native completed legs (actual `dep_time`/`arr_time`) feed it too.
  - For each leg, compute **our own** `greatCircleNm(dep, arr)` (so the recovered cruise speed is consistent with the distance metric we estimate with — not LF's distance).
  - Group by `aircraft_type`; linear-regress `flight_min ~ distance_nm` via `simple-statistics`. `cruise_kt = 60 / slope`, `buffer_min = intercept`, plus `n_legs`, `r2`.
  - Require a minimum sample (e.g. `>= 8` legs) to update a profile; otherwise keep the existing/seed profile.
  - Upsert into `scheduling_perf_profiles`.
- **Seed:** a `DEFAULT_PROFILE` (GIV-SP `{cruise_kt: 452, buffer_min: 14}`) used when no calibrated row exists for a type.
- **Trigger:** runs on the sync-worker tick (alongside the existing mirror + auto-close), so it refreshes as data grows. Also callable on demand.
- The pure regression step is unit-tested with synthetic (distance, minutes) pairs.

### 4. Flight-time engine (`backend/src/scheduling/flightTime.js`)
- `estimateLegMinutes({ depIcao, arrIcao, aircraftType }, profile)` — `buffer + greatCircleNm / cruise × 60`. Pure.
- `flightTimeForLeg(leg, { profile, history })` — returns `{ minutes, distanceNm, source: 'history' | 'estimate' }`:
  - **history override:** if we have prior completed legs on the same `dep→arr` (and type), use their average actual block minutes (Option A — strictly better than the estimate on known routes).
  - else the estimate above.
- Pure decision logic tested; DB lookups injected.

### 5. Pricing (`backend/src/scheduling/pricing.js`)
- Reuse the **existing rate-card formula** (the math in `quoteEngine.js`: `hourly_rate`, `min_hours`, short-leg, `positioning_rate` for ferry legs, `overnight_fee`/threshold, `segment_fee_per_pax`, `fet_rate`). Extract that math into a shared pure function so both the email-quote path (`quoteEngine.js`) and this scheduling path use **one source of truth** (DRY) — no second pricing implementation.
- `priceTrip({ legs:[{minutes, distanceNm, pax, isPositioning}], rateCard, nights })` → breakdown:
  ```
  { perLeg:[{from,to,hrs,cost}], totalHrs, flightCost, billableNights,
    overnightCost, segmentFee, subtotal, fetRate, fetAmount, total, rateName, tail }
  ```
- Rate card is selected by the trip's tail from the existing `rate_cards` table; fall back to a default/error if none.
- Pure, unit-tested against a worked example.

### 6. Quote assembly (wired into `routes/scheduling.js`)
- On `POST /api/scheduling/trips` (create quote) and a new `POST /api/scheduling/trips/:id/price` (re-price), run: per leg → flight time + distance → `priceTrip` → store the breakdown in `scheduling_trips.pricing` (jsonb, already exists) and `rate_name`.
- `GET /api/scheduling/trips/:id` returns the stored `pricing` so the trip/quote page can render the breakdown.
- New-quote form gains an optional **pax count per leg** and **positioning** flag (needed for segment fee + ferry pricing); both default sensibly.

### 7. Frontend
- **Quote/trip page** (`SchedulingTripDetail`): a **Pricing breakdown** card — per-leg hours & cost, then flight cost, overnight, segment fee, subtotal, FET, **total** — matching how LevelFlight presents a quote. A **Re-price** button calls the price endpoint (after editing legs/pax).
- **Quotes list** already shows a summary; add the **total** once priced.
- (Editing legs/pax on an existing quote is a later slice; v1 prices on create + manual re-price.)

## Data flow

1. User creates a quote (aircraft, customer, legs, pax).
2. Backend computes distance + flight time per leg (history override or estimate from the current profile).
3. `priceTrip` applies the tail's rate card → breakdown.
4. Breakdown saved to `scheduling_trips.pricing`; total surfaced in the Quotes list and on the trip page.
5. Separately, on each sync-worker tick, `calibratePerfProfiles()` refreshes the per-type cruise/buffer from the latest completed-leg history.

## Error handling / fallbacks

- Unknown airport (no coords) → distance `null`, flight time falls back to a flat default (e.g. 120 min) and the breakdown flags the leg as **estimated/unknown airport** rather than failing the quote.
- No rate card for the tail → return the trip un-priced with a clear "no rate card for `<tail>`" message (don't guess).
- Calibration with too few legs for a type → keep the seed/default profile; never block pricing on calibration.
- Auto-recalibration is best-effort on the worker tick (never fails the sync), mirroring the auto-close pattern.

## Testing

- Pure units: `distance` (haversine vs known pairs), `flightTime` estimate + history-override decision, `perfProfile` regression (synthetic pairs recover known constants), `pricing` (worked rate-card example), `airports` lookup.
- Route-level: price-on-create stores a breakdown; re-price endpoint; unknown-airport / no-rate-card fallbacks.
- Calibration sanity: re-running the recovered fit on the seed data reproduces ~452 kt / ~14 min.

## Out of scope (future slices)

- Editing legs/crew/passengers on an existing quote (separate builder slice).
- Fuel cost / tankering, catering, de-ice, international handling line items beyond the current rate-card fields.
- Live wind/route flight planning (ForeFlight stays ops-only).
- Per-route distance padding tuning beyond the single `ROUTING_FACTOR` constant.
- Multi-type fleets (works already via per-type profiles; just untested until a second type exists).

## Open questions (resolved)

- **Flight-time method:** great-circle ÷ cruise + buffer, LevelFlight's own method, constants recovered from history. ✅
- **Profile source:** auto-recalibrate from completed-leg history (seeded at GIV-SP 452/14). ✅
- **Pricing:** reuse existing Rate Cards + the `quoteEngine` formula (extracted to a shared module). ✅
- **Billing basis:** flight time (matches LevelFlight's `breakdown.flightMins`), not block time.
