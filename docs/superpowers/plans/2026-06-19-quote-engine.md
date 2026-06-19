# Quote Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Price native quotes in the Scheduling section by computing each leg's distance + flight time (LevelFlight's own method, constants recovered from history) and applying the operator's existing Rate Cards, storing a line-item breakdown on the trip.

**Architecture:** Pure, separately-tested backend modules — `airports` (ICAO→coords), `distance` (haversine), `perfProfile` (auto-recalibrated cruise/buffer per aircraft type), `flightTime` (history-override else estimate), `pricing` (rate-card formula extracted from the existing `quoteEngine.js`) — composed in `routes/scheduling.js` on quote create + a re-price endpoint, surfaced as a breakdown card on the trip page. Auto-recalibration runs on the existing sync-worker tick.

**Tech Stack:** Node ESM, `@supabase/supabase-js`, `simple-statistics` (already a dep), `node:test`/`node:assert/strict` (run `node --test backend/src/scheduling/*.test.js`); React 19 + Vite frontend verified by `npm run build`. Supabase migrations applied by the user.

**Reference spec:** `docs/superpowers/specs/2026-06-19-quote-engine-design.md`

**Conventions to follow (match existing code):**
- Scheduling modules live in `backend/src/scheduling/`, pure logic separated from Supabase I/O so it is unit-testable; DB glue (imports `../services/supabase.js`) is thin and not unit-tested (mirror `autoClose.js`/`nativeLegStatus.js`).
- Money rounded to whole dollars; hours to 2 decimals (match `quoteEngine.js`).
- Status/route style and inline-CSS-vars frontend style as in `SchedulingTripDetail.jsx`.
- Each task ends with a commit. Run `node --check` on any route file touched and `cd frontend && npm run build` for any frontend change.

---

## Task 1: Airport coordinates (harvest + lookup)

**Files:**
- Create: `backend/scripts/harvestAirports.mjs` (one-time generator; reads the mirror, writes the data file)
- Create: `backend/src/scheduling/data/airports.json` (generated asset: `{ "KFXE": {"lat":..,"lng":..}, ... }`)
- Create: `backend/src/scheduling/airports.js`
- Test: `backend/src/scheduling/airports.test.js`

- [ ] **Step 1: Write the harvest script**

`backend/scripts/harvestAirports.mjs` — reads every mirrored leg's snapshot and maps `departure.airport`→`_calc.from.location` and `arrival.airport`→`_calc.to.location` into a sorted ICAO→coords JSON. Read-only on the DB; writes the data file.

```js
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const out = {};
const add = (icao, loc) => {
  if (!icao || !loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return;
  out[String(icao).trim().toUpperCase()] = { lat: loc.lat, lng: loc.lng };
};

let from = 0;
for (;;) {
  const { data, error } = await sb
    .from('scheduling_legs').select('lf_synced_snapshot')
    .eq('origin', 'levelflight').range(from, from + 999);
  if (error) throw error;
  if (!data?.length) break;
  for (const r of data) {
    const s = r.lf_synced_snapshot || {};
    add(s.departure?.airport, s._calc?.from?.location);
    add(s.arrival?.airport, s._calc?.to?.location);
  }
  if (data.length < 1000) break;
  from += 1000;
}

const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
const dir = fileURLToPath(new URL('../src/scheduling/data/', import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(dir + 'airports.json', JSON.stringify(sorted, null, 0) + '\n');
console.log(`Wrote ${Object.keys(sorted).length} airports to src/scheduling/data/airports.json`);
```

- [ ] **Step 2: Run the harvest to generate the data file**

Run: `cd backend && node scripts/harvestAirports.mjs`
Expected: `Wrote <N> airports ...` (N ≥ the distinct airports in the mirror, e.g. KFXE, KTEB, KMIA, MMUN, etc.) and `src/scheduling/data/airports.json` exists. If N is 0, the mirror is empty — stop and report.

- [ ] **Step 3: Write the failing test for the lookup**

`backend/src/scheduling/airports.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airportCoord } from './airports.js';

test('airportCoord returns coords for a known airport, case/space-insensitive', () => {
  const kfxe = airportCoord('KFXE');
  assert.ok(kfxe && typeof kfxe.lat === 'number' && typeof kfxe.lng === 'number');
  assert.deepEqual(airportCoord(' kfxe '), kfxe);
});

test('airportCoord returns null for unknown/blank input', () => {
  assert.equal(airportCoord('ZZZZ'), null);
  assert.equal(airportCoord(''), null);
  assert.equal(airportCoord(null), null);
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `node --test backend/src/scheduling/airports.test.js`
Expected: FAIL (`airports.js` not found / no export).

- [ ] **Step 5: Implement the lookup**

`backend/src/scheduling/airports.js`:

```js
import { readFileSync } from 'node:fs';

// ICAO -> { lat, lng }. Generated from the mirror by scripts/harvestAirports.mjs
// (LevelFlight's own coordinates). Regenerate to add airports as the fleet flies
// new fields, or hand-add entries to data/airports.json.
const AIRPORTS = JSON.parse(readFileSync(new URL('./data/airports.json', import.meta.url)));

export function airportCoord(icao) {
  if (!icao || typeof icao !== 'string') return null;
  return AIRPORTS[icao.trim().toUpperCase()] || null;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test backend/src/scheduling/airports.test.js`
Expected: PASS (2/2).

- [ ] **Step 7: Commit**

```bash
git add backend/scripts/harvestAirports.mjs backend/src/scheduling/data/airports.json backend/src/scheduling/airports.js backend/src/scheduling/airports.test.js
git commit -m "feat(scheduling): airport coordinate table (harvested from mirror) + lookup"
```

---

## Task 2: Great-circle distance

**Files:**
- Create: `backend/src/scheduling/distance.js`
- Test: `backend/src/scheduling/distance.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greatCircleNm } from './distance.js';

test('greatCircleNm matches a known pair within 1%', () => {
  // KFXE (26.197,-80.171) -> KTEB (40.850,-74.061) ≈ 925 nm
  const nm = greatCircleNm({ lat: 26.197, lng: -80.171 }, { lat: 40.850, lng: -74.061 });
  assert.ok(Math.abs(nm - 925) / 925 < 0.01, `got ${nm}`);
});

test('greatCircleNm is zero for identical points and null-safe', () => {
  assert.equal(greatCircleNm({ lat: 26, lng: -80 }, { lat: 26, lng: -80 }), 0);
  assert.equal(greatCircleNm(null, { lat: 1, lng: 1 }), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test backend/src/scheduling/distance.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// Great-circle distance in nautical miles (haversine). Earth radius 3440.065 nm.
const R_NM = 3440.065;
const toRad = (d) => (d * Math.PI) / 180;

export function greatCircleNm(a, b) {
  if (!a || !b) return null;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test backend/src/scheduling/distance.test.js`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add backend/src/scheduling/distance.js backend/src/scheduling/distance.test.js
git commit -m "feat(scheduling): great-circle (haversine) distance in nm"
```

---

## Task 3: Aircraft performance profile — pure fit + migration + calibration

**Files:**
- Create: `backend/migrations/009_perf_profiles.sql`
- Create: `backend/src/scheduling/perfProfile.js`
- Create: `backend/src/scheduling/perfProfile.test.js`

- [ ] **Step 1: Write the migration**

`backend/migrations/009_perf_profiles.sql`:

```sql
-- Auto-recalibrated flight-time profile per aircraft type (cruise kt + fixed buffer).
create table if not exists scheduling_perf_profiles (
  aircraft_type text primary key,
  cruise_kt   numeric not null,
  buffer_min  numeric not null,
  n_legs      integer not null default 0,
  r2          numeric,
  updated_at  timestamptz not null default now()
);
```

- [ ] **Step 2: Write the failing test for the pure fit**

`backend/src/scheduling/perfProfile.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitProfile, DEFAULT_PROFILE, MIN_LEGS } from './perfProfile.js';

test('fitProfile recovers cruise + buffer from (distance, minutes) pairs', () => {
  // Synthesize minutes = 14 + nm/452*60 for several distances.
  const pairs = [200, 400, 600, 800, 1000, 1200, 900, 500].map((nm) => [nm, 14 + (nm / 452) * 60]);
  const p = fitProfile(pairs);
  assert.ok(Math.abs(p.cruise_kt - 452) < 2, `cruise ${p.cruise_kt}`);
  assert.ok(Math.abs(p.buffer_min - 14) < 0.5, `buffer ${p.buffer_min}`);
  assert.ok(p.r2 > 0.99);
  assert.equal(p.n_legs, pairs.length);
});

test('fitProfile returns null below the minimum sample or with bad slope', () => {
  assert.equal(fitProfile([[100, 30], [200, 45]]), null); // < MIN_LEGS
  const flat = Array.from({ length: MIN_LEGS }, (_, i) => [100 + i, 60]); // slope ~0
  assert.equal(fitProfile(flat), null);
});

test('DEFAULT_PROFILE seeds the recovered GIV-SP numbers', () => {
  assert.equal(DEFAULT_PROFILE.cruise_kt, 452);
  assert.equal(DEFAULT_PROFILE.buffer_min, 14);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test backend/src/scheduling/perfProfile.test.js`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the pure fit**

`backend/src/scheduling/perfProfile.js`:

```js
import * as ss from 'simple-statistics';

// Seed used until a type has enough history (recovered from 52 GIV-SP legs, R²=0.97).
export const DEFAULT_PROFILE = { cruise_kt: 452, buffer_min: 14 };
export const MIN_LEGS = 8;

// pairs: [[distanceNm, flightMinutes], ...] -> { cruise_kt, buffer_min, n_legs, r2 } | null
export function fitProfile(pairs) {
  if (!Array.isArray(pairs) || pairs.length < MIN_LEGS) return null;
  const lr = ss.linearRegression(pairs); // { m: min per nm, b: intercept min }
  if (!(lr.m > 0) || !Number.isFinite(lr.b)) return null;
  const r2 = ss.rSquared(pairs, ss.linearRegressionLine(lr));
  return {
    cruise_kt: Math.round((60 / lr.m) * 10) / 10,
    buffer_min: Math.round(lr.b * 10) / 10,
    n_legs: pairs.length,
    r2: Math.round(r2 * 1000) / 1000,
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test backend/src/scheduling/perfProfile.test.js`
Expected: PASS (3/3).

- [ ] **Step 6: Add the DB-backed calibration + read (thin glue, after the pure fit)**

Append to `backend/src/scheduling/perfProfile.js` (uses Supabase + `greatCircleNm`; not unit-tested, mirrors `autoClose.js`):

```js
import { supabase } from '../services/supabase.js';
import { airportCoord } from './airports.js';
import { greatCircleNm } from './distance.js';

// Recompute each type's profile from completed-leg history (pricing_history today;
// native completed legs after cutover). Uses OUR haversine distance so the recovered
// cruise speed is consistent with how we estimate. Best-effort; never throws to caller.
export async function calibratePerfProfiles() {
  const { data, error } = await supabase
    .from('pricing_history')
    .select('aircraft_type, origin, destination, flight_mins')
    .gt('flight_mins', 0);
  if (error) throw error;

  const byType = new Map();
  for (const r of data || []) {
    const nm = greatCircleNm(airportCoord(r.origin), airportCoord(r.destination));
    if (!nm || !(r.flight_mins > 0)) continue;
    if (!byType.has(r.aircraft_type)) byType.set(r.aircraft_type, []);
    byType.get(r.aircraft_type).push([nm, r.flight_mins]);
  }

  let updated = 0;
  for (const [type, pairs] of byType) {
    const fit = fitProfile(pairs);
    if (!fit || !type) continue;
    const { error: ue } = await supabase.from('scheduling_perf_profiles').upsert({
      aircraft_type: type, cruise_kt: fit.cruise_kt, buffer_min: fit.buffer_min,
      n_legs: fit.n_legs, r2: fit.r2, updated_at: new Date().toISOString(),
    });
    if (ue) throw ue;
    updated += 1;
  }
  return updated;
}

// Profile for an aircraft type, falling back to the seed.
export async function getPerfProfile(aircraftType) {
  if (aircraftType) {
    const { data } = await supabase
      .from('scheduling_perf_profiles').select('cruise_kt, buffer_min').eq('aircraft_type', aircraftType).maybeSingle();
    if (data) return { cruise_kt: Number(data.cruise_kt), buffer_min: Number(data.buffer_min) };
  }
  return DEFAULT_PROFILE;
}
```

- [ ] **Step 7: Syntax check + re-run pure tests**

Run: `node --check backend/src/scheduling/perfProfile.js && node --test backend/src/scheduling/perfProfile.test.js`
Expected: no syntax error; PASS (3/3).

- [ ] **Step 8: Tell the user to apply the migration**

The migration is not auto-applied. Output to the user: "Run `backend/migrations/009_perf_profiles.sql` in Supabase (creates `scheduling_perf_profiles`)." Do not proceed to Task 7's worker wiring relying on the table until confirmed, but later tasks that only price (Tasks 4–6) work via the seed `DEFAULT_PROFILE`.

- [ ] **Step 9: Commit**

```bash
git add backend/migrations/009_perf_profiles.sql backend/src/scheduling/perfProfile.js backend/src/scheduling/perfProfile.test.js
git commit -m "feat(scheduling): auto-recalibrating aircraft performance profile (cruise/buffer)"
```

---

## Task 4: Flight-time engine

**Files:**
- Create: `backend/src/scheduling/flightTime.js`
- Test: `backend/src/scheduling/flightTime.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateLegMinutes, flightTimeForLeg } from './flightTime.js';

const profile = { cruise_kt: 452, buffer_min: 14 };

test('estimateLegMinutes = buffer + distance/cruise', () => {
  assert.equal(Math.round(estimateLegMinutes(452, profile)), 74); // 14 + 60
  assert.equal(estimateLegMinutes(null, profile), null);
});

test('flightTimeForLeg prefers history when present, else estimates', () => {
  const histAvg = { 'Gulfstream GIV SP|KFXE|KTEB': 132 };
  const h = flightTimeForLeg(
    { depIcao: 'KFXE', arrIcao: 'KTEB', aircraftType: 'Gulfstream GIV SP', distanceNm: 925 },
    { profile, historyAvg: histAvg });
  assert.equal(h.source, 'history');
  assert.equal(h.minutes, 132);

  const e = flightTimeForLeg(
    { depIcao: 'KFXE', arrIcao: 'KMIA', aircraftType: 'Gulfstream GIV SP', distanceNm: 452 },
    { profile, historyAvg: histAvg });
  assert.equal(e.source, 'estimate');
  assert.equal(Math.round(e.minutes), 74);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test backend/src/scheduling/flightTime.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

```js
import { DEFAULT_PROFILE } from './perfProfile.js';

export function estimateLegMinutes(distanceNm, profile = DEFAULT_PROFILE) {
  if (distanceNm == null) return null;
  return profile.buffer_min + (distanceNm / profile.cruise_kt) * 60;
}

// leg: { depIcao, arrIcao, aircraftType, distanceNm }
// opts: { profile, historyAvg }  historyAvg keyed `${type}|${dep}|${arr}` -> avg minutes
export function flightTimeForLeg(leg, { profile = DEFAULT_PROFILE, historyAvg = {} } = {}) {
  const key = `${leg.aircraftType}|${leg.depIcao}|${leg.arrIcao}`;
  const hist = historyAvg[key];
  if (hist != null) return { minutes: hist, distanceNm: leg.distanceNm, source: 'history' };
  return { minutes: estimateLegMinutes(leg.distanceNm, profile), distanceNm: leg.distanceNm, source: 'estimate' };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test backend/src/scheduling/flightTime.test.js`
Expected: PASS (2/2).

- [ ] **Step 5: Add the history map builder (thin glue)**

Append to `flightTime.js` — builds the `historyAvg` map from `pricing_history` (avg actual minutes per type|dep|arr, both directions):

```js
import { supabase } from '../services/supabase.js';

export async function loadHistoryAvg() {
  const { data, error } = await supabase
    .from('pricing_history').select('aircraft_type, origin, destination, flight_mins').gt('flight_mins', 0);
  if (error) throw error;
  const sums = new Map();
  const bump = (k, v) => { const e = sums.get(k) || [0, 0]; e[0] += v; e[1] += 1; sums.set(k, e); };
  for (const r of data || []) {
    bump(`${r.aircraft_type}|${r.origin}|${r.destination}`, r.flight_mins);
    bump(`${r.aircraft_type}|${r.destination}|${r.origin}`, r.flight_mins); // symmetric
  }
  const out = {};
  for (const [k, [sum, n]] of sums) out[k] = Math.round(sum / n);
  return out;
}
```

- [ ] **Step 6: Syntax check + re-run tests; Commit**

Run: `node --check backend/src/scheduling/flightTime.js && node --test backend/src/scheduling/flightTime.test.js`
Expected: PASS.

```bash
git add backend/src/scheduling/flightTime.js backend/src/scheduling/flightTime.test.js
git commit -m "feat(scheduling): flight-time engine (history override else estimate)"
```

---

## Task 5: Pricing module (extract shared formula from quoteEngine)

**Files:**
- Create: `backend/src/scheduling/pricing.js`
- Test: `backend/src/scheduling/pricing.test.js`
- Modify: `backend/src/services/quoteEngine.js` (import the shared `calcLeg`)

- [ ] **Step 1: Write the failing test (mirrors quoteEngine's math, generalized to N legs + positioning)**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcLeg, priceTrip } from './pricing.js';

const rc = {
  aircraft_tail: 'N69FP', rate_name: 'GIV', hourly_rate: 9000, positioning_rate: 4500,
  min_hours: 1, short_leg_time: 0.5, short_leg_amount: 6000,
  overnight_fee: 1500, overnight_threshold: 3, segment_fee_per_pax: 50, fet_rate: 0.075,
};

test('calcLeg applies min hours, short-leg floor, and positioning rate', () => {
  assert.equal(calcLeg(120, rc).cost, 18000);                          // 2h * 9000
  assert.equal(calcLeg(20, rc).cost, 9000);                            // 1h min_hours floor (9000 > short-leg 6000)
  assert.equal(calcLeg(20, { ...rc, min_hours: 0 }).cost, 6000);       // short-leg floor when no min_hours
  assert.equal(calcLeg(120, rc, { isPositioning: true }).cost, 9000);  // 2h * 4500
});

test('priceTrip sums legs, fees, and FET like quoteEngine', () => {
  const q = priceTrip({
    legs: [{ from: 'KFXE', to: 'KTEB', mins: 120, pax: 4 }, { from: 'KTEB', to: 'KFXE', mins: 120, pax: 4 }],
    rateCard: rc, nights: 4,
  });
  assert.equal(q.flightCost, 36000);
  assert.equal(q.billableNights, 1);
  assert.equal(q.overnightCost, 1500);
  assert.equal(q.segmentFee, 400);              // 50 * (4+4)
  assert.equal(q.subtotal, 37900);
  assert.equal(q.fetAmount, 2843);              // round(37900 * 0.075)
  assert.equal(q.total, 40743);
  assert.equal(q.tail, 'N69FP');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test backend/src/scheduling/pricing.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement the shared pricing module**

`backend/src/scheduling/pricing.js`:

```js
// Single source of truth for rate-card pricing. The per-leg math is the same as
// the original quoteEngine.calcLeg; priceTrip generalizes calculateTripQuote to N
// legs with optional positioning legs.
export const calcLeg = (mins, rateCard, { isPositioning = false } = {}) => {
  const hrs = mins / 60;
  const rate = isPositioning && rateCard.positioning_rate > 0 ? rateCard.positioning_rate : rateCard.hourly_rate;
  const applyMin = rateCard.min_hours > 0 ? Math.max(hrs, rateCard.min_hours) : hrs;
  let cost = applyMin * rate;
  if (rateCard.short_leg_time > 0 && hrs < rateCard.short_leg_time) {
    cost = Math.max(cost, rateCard.short_leg_amount || 0);
  }
  return { hrs: Math.round(hrs * 100) / 100, mins, cost: Math.round(cost) };
};

// legs: [{ from, to, mins, pax, isPositioning }]
export const priceTrip = ({ legs, rateCard, nights = 0 }) => {
  const perLeg = legs.map((l) => ({
    from: l.from, to: l.to, source: l.source,
    ...calcLeg(l.mins, rateCard, { isPositioning: l.isPositioning }),
  }));
  const flightCost = perLeg.reduce((s, l) => s + l.cost, 0);
  const totalHrs = Math.round(perLeg.reduce((s, l) => s + l.hrs, 0) * 100) / 100;
  const billableNights = Math.max(0, nights - (rateCard.overnight_threshold || 3));
  const overnightCost = billableNights * (rateCard.overnight_fee || 0);
  const segmentFee = (rateCard.segment_fee_per_pax || 0) * legs.reduce((s, l) => s + (l.pax || 0), 0);
  const subtotal = flightCost + overnightCost + segmentFee;
  const fetAmount = subtotal * (rateCard.fet_rate || 0);
  return {
    perLeg, legs: legs.length, totalHrs,
    flightCost: Math.round(flightCost),
    nights, billableNights, overnightCost: Math.round(overnightCost),
    segmentFee: Math.round(segmentFee),
    subtotal: Math.round(subtotal),
    fetRate: rateCard.fet_rate || 0,
    fetAmount: Math.round(fetAmount),
    total: Math.round(subtotal + fetAmount),
    rateName: rateCard.rate_name || rateCard.aircraft_tail,
    tail: rateCard.aircraft_tail,
  };
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test backend/src/scheduling/pricing.test.js`
Expected: PASS (2/2).

- [ ] **Step 5: DRY the original — make quoteEngine use the shared calcLeg**

In `backend/src/services/quoteEngine.js`: add `import { calcLeg } from '../scheduling/pricing.js';` at the top, and DELETE the local `const calcLeg = (mins, rateCard) => {...}` definition (lines ~60–68). Leave the rest of `calculateTripQuote` unchanged (it calls `calcLeg(mins, rateCard)` — the shared one is call-compatible).

- [ ] **Step 6: Verify the existing quote-engine tests still pass (or syntax-check if none)**

Run: `node --check backend/src/services/quoteEngine.js`
Run (if present): `node --test backend/src/services/*.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: no syntax error; any existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/scheduling/pricing.js backend/src/scheduling/pricing.test.js backend/src/services/quoteEngine.js
git commit -m "feat(scheduling): shared rate-card pricing module (extracted from quoteEngine)"
```

---

## Task 6: Quote assembly — price on create + re-price endpoint

**Files:**
- Create: `backend/src/scheduling/priceQuote.js` (composes distance + flight time + pricing for a trip's legs)
- Modify: `backend/src/routes/scheduling.js` (price on create; new `POST /trips/:id/price`; return `pricing` from GET)
- Modify: `backend/src/scheduling/buildNativeLeg.js` (carry `pax` so segment fees work — optional field)

- [ ] **Step 1: Write `priceQuote.js` (thin composition; DB glue)**

`backend/src/scheduling/priceQuote.js`:

```js
import { supabase } from '../services/supabase.js';
import { airportCoord } from './airports.js';
import { greatCircleNm } from './distance.js';
import { flightTimeForLeg, loadHistoryAvg } from './flightTime.js';
import { getPerfProfile } from './perfProfile.js';
import { priceTrip } from './pricing.js';

const UNKNOWN_AIRPORT_MIN = 150; // fallback flight time when an airport has no coords

// legs: [{ dep_icao, arr_icao, pax, isPositioning }]; returns the priceTrip breakdown
// plus { error } when no rate card exists for the tail (caller decides what to store).
export async function priceQuoteLegs({ tail, aircraftType, legs, nights = 0 }) {
  const { data: rateCard } = await supabase
    .from('rate_cards').select('*').eq('aircraft_tail', tail).maybeSingle();
  if (!rateCard) return { error: `No rate card for ${tail || 'aircraft'}.` };

  const [profile, historyAvg] = await Promise.all([getPerfProfile(aircraftType), loadHistoryAvg()]);

  const priced = legs.map((l) => {
    const distanceNm = greatCircleNm(airportCoord(l.dep_icao), airportCoord(l.arr_icao));
    const ft = flightTimeForLeg(
      { depIcao: l.dep_icao, arrIcao: l.arr_icao, aircraftType, distanceNm },
      { profile, historyAvg });
    const minutes = ft.minutes != null ? ft.minutes : UNKNOWN_AIRPORT_MIN;
    const source = ft.minutes != null ? ft.source : 'unknown-airport';
    return { from: l.dep_icao, to: l.arr_icao, mins: minutes, pax: l.pax || 0, isPositioning: !!l.isPositioning, source };
  });

  return { ...priceTrip({ legs: priced, rateCard, nights }) };
}
```

- [ ] **Step 2: Wire pricing into create + GET, add the re-price route**

In `backend/src/routes/scheduling.js`:

a) Add import: `import { priceQuoteLegs } from '../scheduling/priceQuote.js';`

b) In `POST /trips` (create), after the legs are inserted and before responding, compute and store pricing (best-effort — never fail creation):

```js
try {
  const pricing = await priceQuoteLegs({
    tail: aircraft_tail, aircraftType: null,
    legs: legRows.map((r) => ({ dep_icao: r.dep_icao, arr_icao: r.arr_icao, pax: 0 })),
    nights: 0,
  });
  await supabase.from('scheduling_trips')
    .update({ pricing, rate_name: pricing.rateName || null }).eq('id', trip.id);
} catch (e) { console.warn('[scheduling price-on-create] failed:', e?.message || e); }
```

c) Add the re-price endpoint (editor-gated), after the PATCH route:

```js
// POST /api/scheduling/trips/:lfOid/price — recompute + store the quote breakdown.
router.post('/trips/:lfOid/price', requireSchedulingEditor, async (req, res) => {
  try {
    const col = tripColumn(req.params.lfOid);
    const { data: trip, error } = await supabase
      .from('scheduling_trips').select('id, lf_oid, status').eq(col, req.params.lfOid).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Trip not found' }); throw error; }
    const { data: legs, error: le } = await supabase
      .from('scheduling_legs').select('dep_icao, arr_icao, lf_synced_snapshot').eq('trip_id', trip.id).order('seq');
    if (le) throw le;
    const tail = legs[0]?.lf_synced_snapshot?.dispatch?.aircraft?.tailNumber || null;
    const nights = Number(req.body?.nights) || 0;
    const pax = Number(req.body?.pax) || 0;
    const pricing = await priceQuoteLegs({
      tail, aircraftType: legs[0]?.lf_synced_snapshot?.dispatch?.aircraft?.type?.name || null,
      legs: legs.map((l) => ({ dep_icao: l.dep_icao, arr_icao: l.arr_icao, pax })), nights,
    });
    await supabase.from('scheduling_trips').update({ pricing, rate_name: pricing.rateName || null }).eq('id', trip.id);
    res.json({ pricing });
  } catch (e) {
    console.error('POST /api/scheduling/trips/:lfOid/price:', e.message);
    res.status(500).json({ error: 'Failed to price trip' });
  }
});
```

d) In `shapeTrip`, add `pricing: row.pricing` and include `pricing` in `TRIP_COLS` (so GET returns it). Update `TRIP_COLS` to append `, pricing`.

- [ ] **Step 3: Syntax check + full scheduling suite**

Run: `node --check backend/src/routes/scheduling.js && node --check backend/src/scheduling/priceQuote.js`
Run: `node --test backend/src/scheduling/*.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: no syntax errors; all prior tests still pass (new modules covered by their own units).

- [ ] **Step 4: Commit**

```bash
git add backend/src/scheduling/priceQuote.js backend/src/routes/scheduling.js
git commit -m "feat(scheduling): price quotes on create + re-price endpoint; return pricing"
```

---

## Task 7: Auto-recalibration on the sync-worker tick

**Files:**
- Modify: `backend/src/scheduling/syncWorker.js`

- [ ] **Step 1: Call calibration after each sync (best-effort)**

In `backend/src/scheduling/syncWorker.js`, add `import { calibratePerfProfiles } from './perfProfile.js';` and, inside `syncNow()` after the auto-close line:

```js
await calibratePerfProfiles().catch((e) => console.warn('[scheduling calibrate] failed:', e?.message || e));
```

- [ ] **Step 2: Syntax check**

Run: `node --check backend/src/scheduling/syncWorker.js`
Expected: OK.

- [ ] **Step 3: (After migration 009 is applied) one-shot calibrate to seed the table**

Run a one-off: `cd backend && node -e "import('./src/scheduling/perfProfile.js').then(m=>m.calibratePerfProfiles()).then(n=>console.log('profiles updated:',n))"`
Expected: `profiles updated: 1` (GIV-SP). If it errors that the table is missing, the user hasn't applied migration 009 yet — report and skip.

- [ ] **Step 4: Commit**

```bash
git add backend/src/scheduling/syncWorker.js
git commit -m "feat(scheduling): auto-recalibrate perf profiles on the sync tick"
```

---

## Task 8: Frontend — pricing breakdown + re-price + pax/positioning + total in Quotes

**Files:**
- Modify: `frontend/src/pages/SchedulingTripDetail.jsx` (breakdown card + Re-price button)
- Modify: `frontend/src/pages/SchedulingNewTrip.jsx` (pax + positioning per leg)
- Modify: `frontend/src/pages/Scheduling.jsx` (show quote total in the Quotes list)

- [ ] **Step 1: Pricing breakdown card on the trip page**

In `SchedulingTripDetail.jsx`, read `meta.pricing` and render a card below the status card. Add a money formatter `const usd = (n) => n == null ? '—' : '$' + Number(n).toLocaleString();` and a Re-price handler:

```jsx
const reprice = async () => {
  setBusy(true); setError(null);
  try {
    const r = await apiFetch(`/api/scheduling/trips/${id}/price`, { method: 'POST', body: JSON.stringify({}) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Pricing failed (${r.status})`); }
    await load();
  } catch (e) { setError(e.message); }
  setBusy(false);
};
```

Card JSX (after the status card; only when `meta?.pricing`):

```jsx
{meta?.pricing && (
  <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Quote — {usd(meta.pricing.total)}</span>
      <button onClick={reprice} disabled={busy} style={{ padding: '6px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>↻ Re-price</button>
    </div>
    <table style={{ width: '100%', fontSize: 13, color: 'var(--text-secondary)', borderCollapse: 'collapse' }}>
      <tbody>
        {meta.pricing.perLeg?.map((l, i) => (
          <tr key={i}><td style={{ padding: '3px 0' }}>{l.from} → {l.to} · {l.hrs}h{l.source === 'estimate' ? ' (est)' : l.source === 'unknown-airport' ? ' (no coords)' : ''}</td><td style={{ textAlign: 'right' }}>{usd(l.cost)}</td></tr>
        ))}
        <tr><td style={{ padding: '3px 0' }}>Flight cost</td><td style={{ textAlign: 'right' }}>{usd(meta.pricing.flightCost)}</td></tr>
        {meta.pricing.overnightCost > 0 && <tr><td>Overnights ({meta.pricing.billableNights})</td><td style={{ textAlign: 'right' }}>{usd(meta.pricing.overnightCost)}</td></tr>}
        {meta.pricing.segmentFee > 0 && <tr><td>Segment fees</td><td style={{ textAlign: 'right' }}>{usd(meta.pricing.segmentFee)}</td></tr>}
        <tr><td>FET ({Math.round((meta.pricing.fetRate || 0) * 1000) / 10}%)</td><td style={{ textAlign: 'right' }}>{usd(meta.pricing.fetAmount)}</td></tr>
        <tr><td style={{ paddingTop: 6, fontWeight: 700, color: 'var(--text-primary)' }}>Total</td><td style={{ paddingTop: 6, textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>{usd(meta.pricing.total)}</td></tr>
      </tbody>
    </table>
  </div>
)}
```

- [ ] **Step 2: Build to verify the trip page compiles**

Run: `cd frontend && npm run build 2>&1 | grep -E "built in|error|Error" | head`
Expected: `built in ...`.

- [ ] **Step 3: Pax + positioning on the new-quote form**

In `SchedulingNewTrip.jsx`, extend `blankLeg()` to `{ dep_icao:'', arr_icao:'', dep_time:'', arr_time:'', pax:'', positioning:false }`, add a small **Pax** number input and a **Positioning** checkbox per leg row, and include them in the POST body's `legs` (`pax: Number(l.pax)||0, isPositioning: l.positioning`). (Backend `priceQuoteLegs` already reads `pax`/`isPositioning`; `POST /trips` should pass them through to `priceQuoteLegs` — update the create handler's `legs.map` in Task 6 Step 2b to use the submitted pax/positioning instead of `pax:0` if present.)

- [ ] **Step 4: Show the quote total in the Quotes list**

In `Scheduling.jsx` `QuotesView`, the `/api/scheduling/quotes` rows don't include price yet. Add `pricing` to the quotes endpoint select (`scheduling_trips ... select('id, lf_oid, trip_number, status, origin, pricing')`) and include `total: t.pricing?.total ?? null` in each quote object (Task 6-adjacent backend tweak), then render `{q.total != null ? ' · ' + usd(q.total) : ''}` in the quote row meta line.

- [ ] **Step 5: Build to verify the whole frontend compiles**

Run: `cd frontend && npm run build 2>&1 | grep -E "built in|error|Error" | head`
Expected: `built in ...`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/SchedulingTripDetail.jsx frontend/src/pages/SchedulingNewTrip.jsx frontend/src/pages/Scheduling.jsx backend/src/routes/scheduling.js
git commit -m "feat(scheduling): quote pricing breakdown UI + pax/positioning + total in Quotes"
```

---

## Final verification (after all tasks)

- [ ] `node --test backend/src/scheduling/*.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)"` — all pass (existing 48 + new units for airports/distance/perfProfile/flightTime/pricing).
- [ ] `node --check backend/src/routes/scheduling.js` — OK.
- [ ] `cd frontend && npm run build` — succeeds.
- [ ] Migration 009 applied by the user; one-shot `calibratePerfProfiles()` seeded the profile (~452/14).
- [ ] Manual smoke (user, in the UI): create a quote with a known route → pricing card shows leg hours + total; Re-price works; total appears in the Quotes list; Book still advances it.
- [ ] Dispatch a final code-review subagent over the whole diff, then `superpowers:finishing-a-development-branch`.

## Notes / decisions captured
- Unknown airport → flat 150-min fallback + per-leg `source: 'unknown-airport'` flag (don't fail the quote). Extend `airports.json` (re-run the harvest) to fix coverage.
- No rate card for the tail → quote stored with `{ error }`; surface "no rate card for `<tail>`" rather than guessing. (Frontend may show the message instead of a breakdown.)
- FET applied to the subtotal (flight + overnight + segment), matching the existing `quoteEngine` behavior. Bill basis = flight time (matches LevelFlight `breakdown.flightMins`).
- Routing factor held at 1.0 (great-circle matched LF closely); `_calc.baseDistance` vs `_calc.distance` in the mirror can be compared later to tune it.
