# Fleet — Aircraft Profiles, Components & Time-Tracking + Pilot Flight Info — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Fleet area with editable aircraft profiles imported from LevelFlight, per-aircraft components (engine/APU/airframe) whose running hours/cycles auto-accrue after each flight, and a pilot Flight Info (post-flight) page that supplies the OOOI times driving that accrual.

**Architecture:** Five new Supabase tables (migration `022`). Pure mappers + soft-fail stores in `backend/src/fleet/` and `backend/src/scheduling/flightInfoStore.js`. The accrual engine reads completed `flight_info` rows and writes an idempotent `component_time_entries` ledger; component totals = baseline + Σ(ledger). New `routes/fleet.js` (`/api/fleet`) plus leg-scoped Flight Info endpoints under `/api/scheduling`. A reconciler pass backfills accrual. Frontend: a `/fleet/*` React area and a `FlightInfoTab.jsx` registered in `SchedulingTripDetail.jsx`.

**Tech Stack:** Node 20 ESM + Express, `@supabase/supabase-js` (service key, PostgREST — no DDL), native `node:test`; React 19 + Vite, React Router 7, inline styles + CSS vars. Tests live next to source as `*.test.js`.

**Conventions to follow (from CLAUDE.md):**
- Migrations are **manual** — write idempotent SQL (`IF NOT EXISTS`), then ask the user to run it in the Supabase SQL editor. Stores must **soft-fail** when a table/column is absent.
- Numbering/text-max in JS, not SQL. Tails canonicalized with the existing `normReg`.
- Never print `.env` values or real passenger PII.
- **Keep `CLAUDE.md` current in the same change** (final task).
- Run backend tests with `node --test <files>`. Frontend build check: `cd frontend && npm run build`.

**Baseline before starting:** from the worktree root run `cd backend && npm install` and `cd frontend && npm install`, then `node --test backend/src/scheduling/*.test.js backend/src/services/*.test.js` and confirm the suite passes (record the count). If anything fails on a clean `origin/main`, stop and report.

---

## File structure

**Backend (new):**
- `backend/migrations/022_fleet.sql` — the five tables
- `backend/src/fleet/aircraftStore.js` (+ `.test.js`) — aircraft CRUD (soft-fail)
- `backend/src/fleet/componentStore.js` (+ `.test.js`) — component CRUD, ledger writes, `recomputeTotals`
- `backend/src/fleet/lfAircraftMap.js` (+ `.test.js`) — **pure** LF object → our rows
- `backend/src/fleet/lfAircraftImport.js` — orchestrates LF fetch + map + upsert (I/O)
- `backend/src/fleet/componentAccrual.js` (+ `.test.js`) — **pure** accrual calc + a thin DB applier
- `backend/src/scheduling/flightInfoStore.js` (+ `.test.js`) — flight_info + flight_info_crew CRUD, OOOI math, LF-`block` pre-fill
- `backend/src/routes/fleet.js` — `/api/fleet` router
- `backend/src/middleware/requireFlightInfoAccess.js` — crew-or-editor guard

**Backend (modified):**
- `backend/src/services/levelflight.js` — add `getAircraftList()`, `getAircraftDetail(id)`, `getOtherFlightTimes()`
- `backend/src/routes/scheduling.js` — add the three `legs/:legId/flight-info` routes
- `backend/src/index.js` — mount `/api/fleet`; call the accrual backfill inside the reconciler wiring
- `backend/src/services/flightTrackReconciler.js` — invoke `accrueAllCompleted()` best-effort each tick

**Frontend (new):** `frontend/src/lib/flightTime.js` (+ `.test.js`); `frontend/src/pages/fleet/FleetAircraftList.jsx`, `FleetAircraftDetail.jsx`, `FleetComponents.jsx`; `frontend/src/components/fleet/AircraftBasicInfoForm.jsx`, `AircraftPerformanceForm.jsx`, `ComponentList.jsx`, `AddComponentModal.jsx`, `ComponentLedger.jsx`; `frontend/src/components/scheduling/FlightInfoTab.jsx`.

**Frontend (modified):** `frontend/src/App.jsx` (routes for `/fleet/*`); `frontend/src/pages/SchedulingTripDetail.jsx` (register the Flight Info tab — single-line change); `frontend/src/lib/api.js` reused as-is.

**Docs (modified):** `CLAUDE.md`.

---

## Task 1: Migration 022 — the five tables

**Files:**
- Create: `backend/migrations/022_fleet.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 022_fleet.sql — Fleet: aircraft profiles, components, time ledger, pilot flight info.
-- Idempotent. Apply manually in the Supabase SQL editor.

create table if not exists aircraft (
  id uuid primary key default gen_random_uuid(),
  tail text not null unique,
  lf_aircraft_oid text unique,
  origin text not null default 'manual' check (origin in ('levelflight','manual')),
  active boolean not null default true,
  serial text, color text, call_sign text, cbp_decal_number text,
  year int, amenities text, base_icao text, fbo_name text,
  is_91_only boolean, owner_company text, foreflight_enabled boolean,
  pax_seats int, aircraft_type text, engines_count int,
  cruise_speed_kt numeric, fuel_burn_1_lbs numeric, fuel_burn_2_lbs numeric, fuel_burn_3_lbs numeric,
  max_altitude_ft numeric, max_landing_weight_lbs numeric, min_landing_distance_ft numeric,
  max_gross_takeoff_weight_lbs numeric, max_fuel_capacity_lbs numeric,
  lf_synced_snapshot jsonb, synced_at timestamptz, locally_modified boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists aircraft_components (
  id uuid primary key default gen_random_uuid(),
  aircraft_id uuid not null references aircraft(id) on delete cascade,
  lf_component_oid text unique,
  component_type text not null check (component_type in ('engine','apu','airframe')),
  position text not null,
  serial text, model text, manufacturer text, note text,
  baseline_hours numeric not null default 0,
  baseline_cycles int not null default 0,
  baseline_at timestamptz not null default now(),
  total_hours numeric not null default 0,
  total_cycles int not null default 0,
  apu_last_reading int,                       -- running-total APU cycles reading (apu only)
  accrues_flight_time boolean not null default true,
  tracks_cycles boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_components_aircraft on aircraft_components(aircraft_id);

create table if not exists component_time_entries (
  id uuid primary key default gen_random_uuid(),
  component_id uuid not null references aircraft_components(id) on delete cascade,
  source text not null check (source in ('baseline','flight_info','manual','adjustment')),
  leg_id uuid,                                 -- scheduling_legs.id (null for baseline/manual/adjustment)
  hours_delta numeric not null default 0,
  cycles_delta int not null default 0,
  time_source text,                            -- crew|live|exact|approx
  note text, created_by text,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_entry_component_leg
  on component_time_entries(component_id, leg_id) where leg_id is not null;
create index if not exists idx_entries_component on component_time_entries(component_id);

create table if not exists flight_info (
  id uuid primary key default gen_random_uuid(),
  scheduling_leg_id uuid not null unique references scheduling_legs(id) on delete cascade,
  out_at timestamptz, off_at timestamptz, on_at timestamptz, in_at timestamptz,
  takeoff_tod text check (takeoff_tod in ('day','night')),
  landing_tod text check (landing_tod in ('day','night')),
  fuel_start_lbs numeric, fuel_stop_lbs numeric,
  apu_start numeric, apu_stop numeric, apu_end_cycles int,
  engine_1_oil_pints numeric, engine_2_oil_pints numeric,
  delay_reason text,
  approach_type text check (approach_type in ('precision','non_precision','visual')),
  debrief jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','complete')),
  completed_at timestamptz, completed_by text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists flight_info_crew (
  id uuid primary key default gen_random_uuid(),
  flight_info_id uuid not null references flight_info(id) on delete cascade,
  crew_lf_oid text, role text check (role in ('PIC','SIC')),
  performed_takeoff boolean, performed_landing boolean,
  imc_hours numeric, night_hours numeric
);
create index if not exists idx_ficrew_flight_info on flight_info_crew(flight_info_id);
```

- [ ] **Step 2: Verify it parses (lightweight)**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('backend/migrations/022_fleet.sql','utf8');if(!/create table if not exists aircraft\b/.test(s)||!/uq_entry_component_leg/.test(s))throw new Error('missing DDL');console.log('022 OK, '+s.length+' bytes')"`
Expected: `022 OK, <n> bytes`

- [ ] **Step 3: Commit**

```bash
git add backend/migrations/022_fleet.sql
git commit -m "feat(fleet): migration 022 — aircraft, components, time ledger, flight_info"
```

- [ ] **Step 4: Flag to the user** that migration `022` must be applied manually in the Supabase SQL editor before the Fleet API returns data (stores soft-fail until then). Do not block subsequent tasks on this.

---

## Task 2: `lib/flightTime.js` — HH:MM ↔ decimal + OOOI math (pure, frontend + reused logic)

**Files:**
- Create: `frontend/src/lib/flightTime.js`
- Test: `frontend/src/lib/flightTime.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { minutesBetween, minutesToHhmm, hoursFromMinutes } from './flightTime.js';

test('minutesBetween computes whole minutes across day boundary', () => {
  const off = '2026-06-19T23:25:00Z';
  const on = '2026-06-20T01:38:00Z';
  assert.equal(minutesBetween(off, on), 133); // 2:13
});

test('minutesBetween returns null on missing input', () => {
  assert.equal(minutesBetween(null, '2026-06-20T01:38:00Z'), null);
  assert.equal(minutesBetween('2026-06-19T23:25:00Z', undefined), null);
});

test('minutesToHhmm formats with zero padding', () => {
  assert.equal(minutesToHhmm(133), '2:13');
  assert.equal(minutesToHhmm(5), '0:05');
  assert.equal(minutesToHhmm(0), '0:00');
});

test('hoursFromMinutes converts to decimal hours', () => {
  assert.equal(hoursFromMinutes(133), 133 / 60);
  assert.equal(hoursFromMinutes(null), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test frontend/src/lib/flightTime.test.js`
Expected: FAIL — `Cannot find module './flightTime.js'`

- [ ] **Step 3: Write the implementation**

```js
// frontend/src/lib/flightTime.js
// Pure helpers for OOOI/flight-time math. No imports.

export function minutesBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const a = new Date(startIso).getTime();
  const b = new Date(endIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 60000);
}

export function minutesToHhmm(min) {
  if (min == null || Number.isNaN(min)) return '';
  const sign = min < 0 ? '-' : '';
  const m = Math.abs(Math.round(min));
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  return `${sign}${h}:${mm}`;
}

export function hoursFromMinutes(min) {
  if (min == null || Number.isNaN(min)) return null;
  return min / 60;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test frontend/src/lib/flightTime.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/flightTime.js frontend/src/lib/flightTime.test.js
git commit -m "feat(fleet): flightTime util (HH:MM/decimal/OOOI minutes)"
```

---

## Task 3: `fleet/lfAircraftMap.js` — pure LF → rows mapper

**Files:**
- Create: `backend/src/fleet/lfAircraftMap.js`
- Test: `backend/src/fleet/lfAircraftMap.test.js`

Uses the real captured LF aircraft shape (from the probe report): `{ _id.$oid, tailNumber, serial, type{name,engines}, airport, color, year, is91Only, paxSeats, owner{owner{company}}, fbo{name}, cruiseSpeed, fuelBurns[], limits{}, components{engines{1,2},apu}, legacy{time,cycles}, foreflight{active} }`.

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLfAircraft, mapLfComponents } from './lfAircraftMap.js';

const LF = {
  _id: { $oid: 'a1' }, tailNumber: 'N408JS', serial: '1402',
  type: { name: 'Gulfstream GIV SP', engines: 2 },
  airport: 'KFXE', color: 'White', year: 2000, is91Only: true, paxSeats: 14,
  owner: { owner: { company: 'Agro Lewis LLC' } }, fbo: { name: 'BANYAN AIR SERVICE' },
  cruiseSpeed: 464, fuelBurns: [4000, 3200, 3000],
  limits: { maxAltitude: 45000, maxLandingWeight: 66000, minLandingDistance: 3405,
            maxGrossTakeoffWeight: 74600, maxFuelCapacity: 29500 },
  foreflight: { active: true },
  legacy: { time: 9544.05, cycles: 5579 },
  components: {
    engines: {
      1: { _id: { $oid: 'e1' }, manufacturer: 'ROLLS-ROYCE', model: 'TAY611-8', serial: '16933' },
      2: { _id: { $oid: 'e2' }, manufacturer: 'ROLLS-ROYCE', model: 'TAY611-8', serial: '16934' },
    },
    apu: { _id: { $oid: 'au' }, manufacturer: 'HONEYWELL', model: 'GTCP36-150', serial: 'P-903' },
  },
};

test('mapLfAircraft pulls basic info + performance', () => {
  const a = mapLfAircraft(LF);
  assert.equal(a.tail, 'N408JS');
  assert.equal(a.lf_aircraft_oid, 'a1');
  assert.equal(a.origin, 'levelflight');
  assert.equal(a.pax_seats, 14);
  assert.equal(a.aircraft_type, 'Gulfstream GIV SP');
  assert.equal(a.engines_count, 2);
  assert.equal(a.owner_company, 'Agro Lewis LLC');
  assert.equal(a.fbo_name, 'BANYAN AIR SERVICE');
  assert.equal(a.cruise_speed_kt, 464);
  assert.equal(a.fuel_burn_1_lbs, 4000);
  assert.equal(a.fuel_burn_3_lbs, 3000);
  assert.equal(a.max_gross_takeoff_weight_lbs, 74600);
  assert.equal(a.foreflight_enabled, true);
});

test('mapLfComponents yields airframe + 2 engines + apu with identity + baseline', () => {
  const comps = mapLfComponents(LF);
  const byPos = Object.fromEntries(comps.map((c) => [c.position, c]));
  assert.deepEqual(Object.keys(byPos).sort(), ['airframe', 'apu', 'engine_1', 'engine_2']);
  assert.equal(byPos.airframe.component_type, 'airframe');
  assert.equal(byPos.airframe.baseline_hours, 9544.05);
  assert.equal(byPos.airframe.baseline_cycles, 5579);
  assert.equal(byPos.engine_1.serial, '16933');
  assert.equal(byPos.engine_1.lf_component_oid, 'e1');
  assert.equal(byPos.engine_1.accrues_flight_time, true);
  assert.equal(byPos.apu.accrues_flight_time, false);
  assert.equal(byPos.apu.tracks_cycles, false);
  assert.equal(byPos.apu.manufacturer, 'HONEYWELL');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/fleet/lfAircraftMap.test.js`
Expected: FAIL — `Cannot find module './lfAircraftMap.js'`

- [ ] **Step 3: Write the implementation**

```js
// backend/src/fleet/lfAircraftMap.js
// Pure: LevelFlight aircraft object -> our aircraft/component rows. No I/O.

const oid = (v) => (v && typeof v === 'object' && v.$oid) ? v.$oid : (v == null ? null : String(v));
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

export function mapLfAircraft(lf) {
  if (!lf) return null;
  const lim = lf.limits || {};
  const burns = Array.isArray(lf.fuelBurns) ? lf.fuelBurns : [];
  return {
    tail: (lf.tailNumber || '').trim().toUpperCase(),
    lf_aircraft_oid: oid(lf._id),
    origin: 'levelflight',
    active: lf.active !== false,
    serial: lf.serial ?? null,
    color: lf.color ?? null,
    call_sign: lf.callSign ?? null,
    cbp_decal_number: lf.cbpDecalNumber ?? null,
    year: num(lf.year),
    amenities: lf.amenities ?? null,
    base_icao: lf.airport ?? null,
    fbo_name: lf.fbo?.name ?? null,
    is_91_only: lf.is91Only ?? null,
    owner_company: lf.owner?.owner?.company ?? null,
    foreflight_enabled: lf.foreflight?.active ?? null,
    pax_seats: num(lf.paxSeats),
    aircraft_type: lf.type?.name ?? null,
    engines_count: num(lf.type?.engines),
    cruise_speed_kt: num(lf.cruiseSpeed),
    fuel_burn_1_lbs: num(burns[0]),
    fuel_burn_2_lbs: num(burns[1]),
    fuel_burn_3_lbs: num(burns[2]),
    max_altitude_ft: num(lim.maxAltitude),
    max_landing_weight_lbs: num(lim.maxLandingWeight),
    min_landing_distance_ft: num(lim.minLandingDistance),
    max_gross_takeoff_weight_lbs: num(lim.maxGrossTakeoffWeight),
    max_fuel_capacity_lbs: num(lim.maxFuelCapacity),
    lf_synced_snapshot: lf,
  };
}

function engineRow(pos, e) {
  return {
    lf_component_oid: oid(e?._id),
    component_type: 'engine', position: pos,
    serial: e?.serial ?? null, model: e?.model ?? null, manufacturer: e?.manufacturer ?? null,
    note: null, accrues_flight_time: true, tracks_cycles: true,
    baseline_hours: 0, baseline_cycles: 0,
  };
}

export function mapLfComponents(lf) {
  const out = [];
  // airframe baseline seeded from legacy time/cycles
  out.push({
    lf_component_oid: null, component_type: 'airframe', position: 'airframe',
    serial: lf?.serial ?? null, model: lf?.type?.name ?? null, manufacturer: null, note: null,
    accrues_flight_time: true, tracks_cycles: true,
    baseline_hours: num(lf?.legacy?.time) ?? 0, baseline_cycles: num(lf?.legacy?.cycles) ?? 0,
  });
  const eng = lf?.components?.engines || {};
  if (eng['1']) out.push(engineRow('engine_1', eng['1']));
  if (eng['2']) out.push(engineRow('engine_2', eng['2']));
  const apu = lf?.components?.apu;
  if (apu) {
    out.push({
      lf_component_oid: oid(apu._id),
      component_type: 'apu', position: 'apu',
      serial: apu.serial ?? null, model: apu.model ?? null, manufacturer: apu.manufacturer ?? null,
      note: null, accrues_flight_time: false, tracks_cycles: false,
      baseline_hours: 0, baseline_cycles: 0,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/fleet/lfAircraftMap.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/fleet/lfAircraftMap.js backend/src/fleet/lfAircraftMap.test.js
git commit -m "feat(fleet): pure LF aircraft/component mapper"
```

> Note: engine/APU baseline hours/cycles are seeded from LF current-time data fetched separately during import (Task 7); the mapper defaults them to 0 and the import overlays the real readings. The empirical check of which LF endpoint returns per-component hours is resolved in Task 7.

---

## Task 4: `fleet/componentAccrual.js` — pure accrual calc

**Files:**
- Create: `backend/src/fleet/componentAccrual.js`
- Test: `backend/src/fleet/componentAccrual.test.js`

`computeLegEntries(flightInfo, components)` returns the ledger rows a completed flight produces — the heart of the feature. DB application is a separate thin function added in Task 6.

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLegEntries } from './componentAccrual.js';

const legId = '11111111-1111-1111-1111-111111111111';
const completedAt = '2026-06-20T02:00:00Z';
const fi = {
  status: 'complete', scheduling_leg_id: legId, completed_at: completedAt,
  off_at: '2026-06-19T23:25:00Z', on_at: '2026-06-20T01:38:00Z',  // 133 min flight
  out_at: '2026-06-19T23:15:00Z', in_at: '2026-06-20T01:44:00Z',  // 149 min block
  apu_start: 6900, apu_stop: 6902, apu_end_cycles: 12,
};
const baselineBefore = '2026-06-01T00:00:00Z';
const comps = [
  { id: 'af', position: 'airframe', accrues_flight_time: true, tracks_cycles: true, baseline_at: baselineBefore },
  { id: 'e1', position: 'engine_1', accrues_flight_time: true, tracks_cycles: true, baseline_at: baselineBefore },
  { id: 'apu', position: 'apu', accrues_flight_time: false, tracks_cycles: false, baseline_at: baselineBefore, apu_last_reading: 10 },
];

test('engines + airframe accrue Off->On hours and +1 cycle', () => {
  const rows = computeLegEntries(fi, comps);
  const af = rows.find((r) => r.component_id === 'af');
  assert.equal(Math.round(af.hours_delta * 60), 133);
  assert.equal(af.cycles_delta, 1);
  assert.equal(af.source, 'flight_info');
  assert.equal(af.leg_id, legId);
  assert.equal(af.time_source, 'crew');
  const e1 = rows.find((r) => r.component_id === 'e1');
  assert.equal(Math.round(e1.hours_delta * 60), 133);
});

test('APU accrues stop-start hours and running-total cycle delta', () => {
  const rows = computeLegEntries(fi, comps);
  const apu = rows.find((r) => r.component_id === 'apu');
  assert.equal(apu.hours_delta, 2);            // 6902 - 6900
  assert.equal(apu.cycles_delta, 2);           // 12 - 10 (previous reading)
});

test('baseline-date filter: legs completed before baseline_at are skipped', () => {
  const future = [{ ...comps[0], baseline_at: '2026-07-01T00:00:00Z' }];
  assert.deepEqual(computeLegEntries(fi, future), []);
});

test('draft flight info produces no entries', () => {
  assert.deepEqual(computeLegEntries({ ...fi, status: 'draft' }, comps), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/fleet/componentAccrual.test.js`
Expected: FAIL — `Cannot find module './componentAccrual.js'`

- [ ] **Step 3: Write the implementation**

```js
// backend/src/fleet/componentAccrual.js
// Pure: a completed flight_info + an aircraft's components -> ledger entry rows.

function minutesBetween(a, b) {
  if (!a || !b) return null;
  const t0 = new Date(a).getTime(); const t1 = new Date(b).getTime();
  if (Number.isNaN(t0) || Number.isNaN(t1)) return null;
  return Math.round((t1 - t0) / 60000);
}
const num = (v) => (v == null || v === '' ? null : Number(v));

// Returns array of { component_id, source, leg_id, hours_delta, cycles_delta, time_source }
export function computeLegEntries(fi, components) {
  if (!fi || fi.status !== 'complete') return [];
  const legId = fi.scheduling_leg_id;
  const when = fi.completed_at || fi.on_at || fi.in_at;
  const flightMin = minutesBetween(fi.off_at, fi.on_at);
  const rows = [];
  for (const c of components || []) {
    if (c.active === false) continue;
    // baseline-date filter: only accrue legs that completed after this component's baseline
    if (c.baseline_at && when && new Date(when).getTime() <= new Date(c.baseline_at).getTime()) continue;

    if (c.component_type === 'apu' || c.accrues_flight_time === false) {
      const hrs = (num(fi.apu_stop) != null && num(fi.apu_start) != null)
        ? num(fi.apu_stop) - num(fi.apu_start) : null;
      const reading = num(fi.apu_end_cycles);
      const cyc = (reading != null && c.apu_last_reading != null) ? reading - c.apu_last_reading : 0;
      if (hrs == null && !cyc) continue;
      rows.push({
        component_id: c.id, source: 'flight_info', leg_id: legId,
        hours_delta: hrs ?? 0, cycles_delta: cyc || 0, time_source: 'crew',
      });
    } else {
      if (flightMin == null) continue;
      rows.push({
        component_id: c.id, source: 'flight_info', leg_id: legId,
        hours_delta: flightMin / 60,
        cycles_delta: c.tracks_cycles === false ? 0 : 1,
        time_source: 'crew',
      });
    }
  }
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/fleet/componentAccrual.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/fleet/componentAccrual.js backend/src/fleet/componentAccrual.test.js
git commit -m "feat(fleet): pure component-accrual calculator"
```

---

## Task 5: `fleet/aircraftStore.js` — soft-fail aircraft CRUD

**Files:**
- Create: `backend/src/fleet/aircraftStore.js`
- Test: `backend/src/fleet/aircraftStore.test.js`

Follow the existing soft-fail store pattern (see `backend/src/scheduling/syncDb.js` for the `supabase`-absent guard). Tests inject a fake supabase client.

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { listAircraft, upsertAircraftByTail } from './aircraftStore.js';

function fakeSupabase(rows = []) {
  const calls = [];
  return {
    calls,
    from() { return this; },
    select() { calls.push('select'); return { data: rows, error: null,
      order() { return { data: rows, error: null }; } }; },
    upsert(payload, opts) { calls.push(['upsert', payload, opts]); return {
      select() { return { single() { return { data: { id: 'x', ...(Array.isArray(payload) ? payload[0] : payload) }, error: null }; } }; } }; },
  };
}

test('listAircraft returns [] when supabase is null (soft-fail)', async () => {
  assert.deepEqual(await listAircraft(null), []);
});

test('upsertAircraftByTail conflicts on tail', async () => {
  const sb = fakeSupabase();
  await upsertAircraftByTail(sb, { tail: 'N69FP', origin: 'levelflight' });
  const upsertCall = sb.calls.find((c) => Array.isArray(c) && c[0] === 'upsert');
  assert.equal(upsertCall[2].onConflict, 'tail');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/fleet/aircraftStore.test.js`
Expected: FAIL — `Cannot find module './aircraftStore.js'`

- [ ] **Step 3: Write the implementation**

```js
// backend/src/fleet/aircraftStore.js
// Soft-fail store for aircraft profiles. Pass the supabase client in (null => no-op).

export async function listAircraft(supabase) {
  if (!supabase) return [];
  const { data, error } = await supabase.from('aircraft').select('*').order('tail', { ascending: true });
  if (error) { console.warn('[fleet] listAircraft soft-fail:', error.message); return []; }
  return data || [];
}

export async function getAircraft(supabase, idOrTail) {
  if (!supabase) return null;
  const col = /^[0-9a-f]{8}-/i.test(idOrTail) ? 'id' : 'tail';
  const val = col === 'tail' ? String(idOrTail).trim().toUpperCase() : idOrTail;
  const { data, error } = await supabase.from('aircraft').select('*').eq(col, val).maybeSingle();
  if (error) { console.warn('[fleet] getAircraft soft-fail:', error.message); return null; }
  return data || null;
}

export async function upsertAircraftByTail(supabase, row) {
  if (!supabase) return null;
  const payload = { ...row, tail: (row.tail || '').trim().toUpperCase(), updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from('aircraft')
    .upsert(payload, { onConflict: 'tail' }).select().single();
  if (error) { console.warn('[fleet] upsertAircraftByTail soft-fail:', error.message); return null; }
  return data;
}

export async function patchAircraft(supabase, id, patch) {
  if (!supabase) return null;
  const payload = { ...patch, locally_modified: true, updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from('aircraft').update(payload).eq('id', id).select().single();
  if (error) { console.warn('[fleet] patchAircraft soft-fail:', error.message); return null; }
  return data;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/fleet/aircraftStore.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/fleet/aircraftStore.js backend/src/fleet/aircraftStore.test.js
git commit -m "feat(fleet): soft-fail aircraft store"
```

---

## Task 6: `fleet/componentStore.js` — components, ledger, recompute + DB accrual applier

**Files:**
- Create: `backend/src/fleet/componentStore.js`
- Test: `backend/src/fleet/componentStore.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { totalsFromEntries } from './componentStore.js';

test('totalsFromEntries sums baseline + ledger deltas', () => {
  const comp = { baseline_hours: 9000, baseline_cycles: 5000 };
  const entries = [
    { hours_delta: 2.2, cycles_delta: 1 },
    { hours_delta: 1.5, cycles_delta: 1 },
  ];
  const t = totalsFromEntries(comp, entries);
  assert.equal(t.total_hours, 9003.7);
  assert.equal(t.total_cycles, 5002);
});

test('totalsFromEntries with no entries returns baseline', () => {
  const t = totalsFromEntries({ baseline_hours: 100, baseline_cycles: 7 }, []);
  assert.equal(t.total_hours, 100);
  assert.equal(t.total_cycles, 7);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/fleet/componentStore.test.js`
Expected: FAIL — `Cannot find module './componentStore.js'`

- [ ] **Step 3: Write the implementation**

```js
// backend/src/fleet/componentStore.js
// Soft-fail component + ledger store. Pure totals helper is unit-tested.

export function totalsFromEntries(component, entries) {
  const baseH = Number(component?.baseline_hours || 0);
  const baseC = Number(component?.baseline_cycles || 0);
  let h = baseH, c = baseC;
  for (const e of entries || []) { h += Number(e.hours_delta || 0); c += Number(e.cycles_delta || 0); }
  return { total_hours: Math.round(h * 100) / 100, total_cycles: Math.round(c) };
}

export async function listComponents(supabase, aircraftId = null) {
  if (!supabase) return [];
  let q = supabase.from('aircraft_components').select('*');
  if (aircraftId) q = q.eq('aircraft_id', aircraftId);
  const { data, error } = await q;
  if (error) { console.warn('[fleet] listComponents soft-fail:', error.message); return []; }
  return data || [];
}

export async function upsertComponent(supabase, row) {
  if (!supabase) return null;
  const onConflict = row.lf_component_oid ? 'lf_component_oid' : undefined;
  const payload = { ...row, updated_at: new Date().toISOString() };
  const q = supabase.from('aircraft_components');
  const { data, error } = onConflict
    ? await q.upsert(payload, { onConflict }).select().single()
    : await q.insert(payload).select().single();
  if (error) { console.warn('[fleet] upsertComponent soft-fail:', error.message); return null; }
  return data;
}

export async function recomputeTotals(supabase, componentId) {
  if (!supabase) return null;
  const { data: comp } = await supabase.from('aircraft_components').select('*').eq('id', componentId).maybeSingle();
  if (!comp) return null;
  const { data: entries } = await supabase.from('component_time_entries').select('hours_delta,cycles_delta').eq('component_id', componentId);
  const totals = totalsFromEntries(comp, entries || []);
  const { data, error } = await supabase.from('aircraft_components')
    .update({ ...totals, updated_at: new Date().toISOString() }).eq('id', componentId).select().single();
  if (error) { console.warn('[fleet] recomputeTotals soft-fail:', error.message); return null; }
  return data;
}

// Idempotent: upsert one entry per (component_id, leg_id); then recompute.
export async function applyLedgerEntry(supabase, entry) {
  if (!supabase) return null;
  if (entry.leg_id) {
    const { data: existing } = await supabase.from('component_time_entries')
      .select('id').eq('component_id', entry.component_id).eq('leg_id', entry.leg_id).maybeSingle();
    if (existing) {
      await supabase.from('component_time_entries')
        .update({ hours_delta: entry.hours_delta, cycles_delta: entry.cycles_delta, time_source: entry.time_source })
        .eq('id', existing.id);
    } else {
      await supabase.from('component_time_entries').insert(entry);
    }
  } else {
    await supabase.from('component_time_entries').insert(entry);
  }
  return recomputeTotals(supabase, entry.component_id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/fleet/componentStore.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/fleet/componentStore.js backend/src/fleet/componentStore.test.js
git commit -m "feat(fleet): component store, ledger applier, totals recompute"
```

---

## Task 7: LevelFlight fetch methods + import orchestrator

**Files:**
- Modify: `backend/src/services/levelflight.js` (add three methods near existing `getAircraft`)
- Create: `backend/src/fleet/lfAircraftImport.js`
- Test: `backend/src/fleet/lfAircraftImport.test.js` (orchestration with injected fetchers + fake stores)

- [ ] **Step 1: Add LF fetch methods**

In `backend/src/services/levelflight.js`, after the existing `getAircraft`, add:

```js
// Fleet list (the org's aircraft) — NOTE: distinct from getAircraft()'s /api/aircraft/all catalog.
export const getAircraftList = async () => {
  const client = await lf();
  const res = await client.get('/api/aircraft/list');
  return res.data?.aircraft || res.data || [];
};

export const getAircraftDetail = async (id) => {
  const client = await lf();
  const res = await client.get(`/api/aircraft/${encodeURIComponent(id)}`);
  return res.data?.aircraft || res.data || null;
};

// Per-component current hours/cycles (baseline source). Shape confirmed at runtime; tolerate variants.
export const getOtherFlightTimes = async () => {
  const client = await lf();
  const res = await client.get('/api/aircraft/otherFlightTimes');
  return res.data || null;
};
```

- [ ] **Step 2: Write the failing test for the orchestrator**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { importFleet } from './lfAircraftImport.js';

const LF_LIST = [{ _id: { $oid: 'a1' }, tailNumber: 'N69FP', type: { name: 'GIV SP', engines: 2 } }];
const LF_DETAIL = {
  _id: { $oid: 'a1' }, tailNumber: 'N69FP', serial: '1180', type: { name: 'GIV SP', engines: 2 },
  cruiseSpeed: 464, fuelBurns: [4000, 3200, 3000], legacy: { time: 9544, cycles: 5579 },
  components: { engines: { 1: { _id: { $oid: 'e1' }, serial: '16463' } }, apu: { _id: { $oid: 'au' }, serial: 'P-542-C' } },
};

test('importFleet upserts each aircraft and its components, respecting locally_modified', async () => {
  const upsertedAircraft = []; const upsertedComps = [];
  const deps = {
    fetchList: async () => LF_LIST,
    fetchDetail: async () => LF_DETAIL,
    fetchTimes: async () => ({}),
    getExistingByTail: async () => ({ id: 'ac1', locally_modified: false }),
    upsertAircraft: async (row) => { upsertedAircraft.push(row); return { id: 'ac1', ...row }; },
    upsertComponent: async (row) => { upsertedComps.push(row); return { id: 'c', ...row }; },
  };
  const result = await importFleet(deps);
  assert.equal(result.aircraft, 1);
  assert.equal(upsertedAircraft[0].tail, 'N69FP');
  assert.equal(upsertedAircraft[0].cruise_speed_kt, 464);
  const positions = upsertedComps.map((c) => c.position).sort();
  assert.deepEqual(positions, ['airframe', 'apu', 'engine_1']);
  assert.equal(upsertedComps.find((c) => c.position === 'airframe').aircraft_id, 'ac1');
});

test('importFleet skips LF-sourced field overwrite when locally_modified', async () => {
  let patched = null;
  const deps = {
    fetchList: async () => LF_LIST, fetchDetail: async () => LF_DETAIL, fetchTimes: async () => ({}),
    getExistingByTail: async () => ({ id: 'ac1', locally_modified: true }),
    upsertAircraft: async (row) => { patched = row; return { id: 'ac1', ...row }; },
    upsertComponent: async () => ({ id: 'c' }),
  };
  await importFleet(deps);
  // snapshot + sync timestamp still refreshed, but profile fields not forced
  assert.equal(patched.locally_modified, true);
  assert.ok(patched.lf_synced_snapshot);
  assert.equal(patched.cruise_speed_kt, undefined);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test backend/src/fleet/lfAircraftImport.test.js`
Expected: FAIL — `Cannot find module './lfAircraftImport.js'`

- [ ] **Step 4: Write the orchestrator**

```js
// backend/src/fleet/lfAircraftImport.js
// Orchestrates: fetch LF -> map -> upsert. All I/O injected for testability.
import { mapLfAircraft, mapLfComponents } from './lfAircraftMap.js';

// deps: { fetchList, fetchDetail, fetchTimes, getExistingByTail, upsertAircraft, upsertComponent }
export async function importFleet(deps) {
  const list = await deps.fetchList();
  let times = null;
  try { times = await deps.fetchTimes(); } catch { times = null; }
  let aircraftCount = 0, componentCount = 0;

  for (const summary of list || []) {
    const id = summary?._id?.$oid || summary?._id || summary?.id;
    if (!id) continue;
    const detail = await deps.fetchDetail(id);
    const mapped = mapLfAircraft(detail || summary);
    if (!mapped?.tail) continue;

    const existing = await deps.getExistingByTail(mapped.tail);
    let row;
    if (existing?.locally_modified) {
      // never clobber user edits: only refresh snapshot + sync stamp
      row = { tail: mapped.tail, lf_aircraft_oid: mapped.lf_aircraft_oid, origin: 'levelflight',
              locally_modified: true, lf_synced_snapshot: mapped.lf_synced_snapshot,
              synced_at: new Date().toISOString() };
    } else {
      row = { ...mapped, synced_at: new Date().toISOString() };
    }
    const saved = await deps.upsertAircraft(row);
    aircraftCount += 1;

    const comps = mapLfComponents(detail || summary);
    for (const c of comps) {
      const seeded = applyBaselineTimes(c, mapped.tail, times);
      await deps.upsertComponent({ ...seeded, aircraft_id: saved.id });
      componentCount += 1;
    }
  }
  return { aircraft: aircraftCount, components: componentCount };
}

// Overlay per-component baseline hours/cycles from the otherFlightTimes payload when present.
// Tolerates unknown shape: looks up by tail + position/serial; leaves mapper defaults otherwise.
function applyBaselineTimes(comp, tail, times) {
  if (!times) return comp;
  const byTail = times[tail] || times[tail?.toUpperCase()] || null;
  if (!byTail) return comp;
  const rec = byTail[comp.position] || byTail[comp.serial] || null;
  if (!rec) return comp;
  return {
    ...comp,
    baseline_hours: rec.hours != null ? Number(rec.hours) : comp.baseline_hours,
    baseline_cycles: rec.cycles != null ? Number(rec.cycles) : comp.baseline_cycles,
    apu_last_reading: comp.component_type === 'apu' && rec.cycles != null ? Number(rec.cycles) : comp.apu_last_reading,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test backend/src/fleet/lfAircraftImport.test.js`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/levelflight.js backend/src/fleet/lfAircraftImport.js backend/src/fleet/lfAircraftImport.test.js
git commit -m "feat(fleet): LF fetch methods + import orchestrator"
```

> **Empirical follow-up (Open Question 3):** when wiring the route in Task 10, run the existing probe or a one-off authenticated call to confirm the real shape of `/api/aircraft/otherFlightTimes`, then adjust `applyBaselineTimes`'s lookup keys to match. If the endpoint doesn't cleanly return per-component hours, baselines stay editable via the component PATCH (Task 10) — the manual-fallback path the user approved.

---

## Task 8: `scheduling/flightInfoStore.js` — flight info CRUD + OOOI math + LF pre-fill

**Files:**
- Create: `backend/src/scheduling/flightInfoStore.js`
- Test: `backend/src/scheduling/flightInfoStore.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveMinutes, prefillFromBlock } from './flightInfoStore.js';

test('deriveMinutes computes flight and block minutes', () => {
  const fi = { off_at: '2026-06-19T23:25:00Z', on_at: '2026-06-20T01:38:00Z',
               out_at: '2026-06-19T23:15:00Z', in_at: '2026-06-20T01:44:00Z' };
  const d = deriveMinutes(fi);
  assert.equal(d.flight_minutes, 133);
  assert.equal(d.block_minutes, 149);
});

test('prefillFromBlock maps LF block OOOI (epoch ms) to ISO fields', () => {
  const block = { out: 1750000000000, off: 1750000600000, on: 1750007980000, in: 1750008340000 };
  const pre = prefillFromBlock(block);
  assert.equal(pre.out_at, new Date(1750000000000).toISOString());
  assert.equal(pre.on_at, new Date(1750007980000).toISOString());
});

test('prefillFromBlock returns empty object when no block', () => {
  assert.deepEqual(prefillFromBlock(null), {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/scheduling/flightInfoStore.test.js`
Expected: FAIL — `Cannot find module './flightInfoStore.js'`

- [ ] **Step 3: Write the implementation**

```js
// backend/src/scheduling/flightInfoStore.js
// Soft-fail flight_info store + pure OOOI helpers.

function minutesBetween(a, b) {
  if (!a || !b) return null;
  const t0 = new Date(a).getTime(); const t1 = new Date(b).getTime();
  if (Number.isNaN(t0) || Number.isNaN(t1)) return null;
  return Math.round((t1 - t0) / 60000);
}

export function deriveMinutes(fi) {
  return { flight_minutes: minutesBetween(fi?.off_at, fi?.on_at),
           block_minutes: minutesBetween(fi?.out_at, fi?.in_at) };
}

const ms2iso = (v) => (v == null ? null : new Date(typeof v === 'number' ? v : Number(v)).toISOString());

export function prefillFromBlock(block) {
  if (!block) return {};
  const out = {};
  if (block.out != null) out.out_at = ms2iso(block.out);
  if (block.off != null) out.off_at = ms2iso(block.off);
  if (block.on != null) out.on_at = ms2iso(block.on);
  if (block.in != null) out.in_at = ms2iso(block.in);
  return out;
}

export async function getFlightInfo(supabase, legId) {
  if (!supabase) return null;
  const { data, error } = await supabase.from('flight_info')
    .select('*, flight_info_crew(*)').eq('scheduling_leg_id', legId).maybeSingle();
  if (error) { console.warn('[flightInfo] get soft-fail:', error.message); return null; }
  return data || null;
}

export async function upsertFlightInfo(supabase, legId, patch) {
  if (!supabase) return null;
  const payload = { ...patch, scheduling_leg_id: legId, updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from('flight_info')
    .upsert(payload, { onConflict: 'scheduling_leg_id' }).select().single();
  if (error) { console.warn('[flightInfo] upsert soft-fail:', error.message); return null; }
  return data;
}

export async function markComplete(supabase, legId, userEmail) {
  if (!supabase) return null;
  const { data, error } = await supabase.from('flight_info')
    .update({ status: 'complete', completed_at: new Date().toISOString(), completed_by: userEmail, updated_at: new Date().toISOString() })
    .eq('scheduling_leg_id', legId).select().single();
  if (error) { console.warn('[flightInfo] complete soft-fail:', error.message); return null; }
  return data;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/scheduling/flightInfoStore.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/scheduling/flightInfoStore.js backend/src/scheduling/flightInfoStore.test.js
git commit -m "feat(fleet): flight_info store + OOOI/LF-block prefill helpers"
```

---

## Task 9: Accrual wiring — flight-info completion + reconciler backfill

**Files:**
- Create: `backend/src/fleet/accrueLeg.js` (ties store + calc + components together)
- Test: `backend/src/fleet/accrueLeg.test.js`
- Modify: `backend/src/services/flightTrackReconciler.js` (call `accrueAllCompleted` best-effort)

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { accrueLeg } from './accrueLeg.js';

test('accrueLeg resolves aircraft by tail and applies one entry per accruing component', async () => {
  const applied = [];
  const fi = { status: 'complete', scheduling_leg_id: 'L1', completed_at: '2026-06-20T02:00:00Z',
               off_at: '2026-06-19T23:25:00Z', on_at: '2026-06-20T01:38:00Z' };
  const deps = {
    getAircraftByTail: async (t) => (t === 'N69FP' ? { id: 'ac1' } : null),
    listComponents: async () => ([
      { id: 'af', component_type: 'airframe', position: 'airframe', accrues_flight_time: true, tracks_cycles: true, baseline_at: '2026-06-01T00:00:00Z' },
      { id: 'e1', component_type: 'engine', position: 'engine_1', accrues_flight_time: true, tracks_cycles: true, baseline_at: '2026-06-01T00:00:00Z' },
    ]),
    applyLedgerEntry: async (e) => { applied.push(e); },
  };
  const n = await accrueLeg(deps, fi, 'N69FP');
  assert.equal(n, 2);
  assert.deepEqual(applied.map((e) => e.component_id).sort(), ['af', 'e1']);
});

test('accrueLeg returns 0 when tail has no aircraft row', async () => {
  const deps = { getAircraftByTail: async () => null, listComponents: async () => [], applyLedgerEntry: async () => {} };
  assert.equal(await accrueLeg(deps, { status: 'complete', scheduling_leg_id: 'L1' }, 'ZZZ'), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/fleet/accrueLeg.test.js`
Expected: FAIL — `Cannot find module './accrueLeg.js'`

- [ ] **Step 3: Write the implementation**

```js
// backend/src/fleet/accrueLeg.js
import { computeLegEntries } from './componentAccrual.js';
import { normReg } from '../services/adsbTrack.js';

// deps: { getAircraftByTail, listComponents, applyLedgerEntry }
export async function accrueLeg(deps, flightInfo, tail) {
  if (!flightInfo || flightInfo.status !== 'complete' || !tail) return 0;
  const ac = await deps.getAircraftByTail(normReg(tail));
  if (!ac) return 0;
  const comps = await deps.listComponents(ac.id);
  const entries = computeLegEntries(flightInfo, comps);
  for (const e of entries) await deps.applyLedgerEntry(e);
  return entries.length;
}
```

> If `normReg` isn't exported from `services/adsbTrack.js`, export it there (one-line `export`) — it is already used app-wide for tail canonicalization.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/fleet/accrueLeg.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Add the reconciler backfill hook**

In `backend/src/services/flightTrackReconciler.js`, inside the periodic tick (after actuals settle), add a best-effort call wrapped in try/catch so it never breaks the reconciler:

```js
// best-effort: roll completed pilot flight-info into component times
try {
  const { accrueAllCompleted } = await import('../fleet/accrueAllCompleted.js');
  await accrueAllCompleted();
} catch (e) { console.warn('[reconciler] component accrual skipped:', e.message); }
```

Create `backend/src/fleet/accrueAllCompleted.js` — a thin wrapper that loads the real supabase client + stores, scans `flight_info` where `status='complete'`, resolves each leg's tail from its `scheduling_legs` snapshot, and calls `accrueLeg`. It soft-fails (returns 0) when supabase/tables are absent. (No unit test required — it is pure wiring over already-tested units; keep it under ~40 lines.)

```js
// backend/src/fleet/accrueAllCompleted.js
import { supabase } from '../services/supabase.js';
import { getAircraft } from './aircraftStore.js';
import { listComponents, applyLedgerEntry } from './componentStore.js';
import { accrueLeg } from './accrueLeg.js';

export async function accrueAllCompleted() {
  if (!supabase) return 0;
  const { data: rows, error } = await supabase
    .from('flight_info')
    .select('*, scheduling_legs(lf_synced_snapshot, dep_icao)')
    .eq('status', 'complete');
  if (error || !rows) return 0;
  const deps = {
    getAircraftByTail: (t) => getAircraft(supabase, t),
    listComponents: (acId) => listComponents(supabase, acId),
    applyLedgerEntry: (e) => applyLedgerEntry(supabase, e),
  };
  let total = 0;
  for (const fi of rows) {
    const tail = fi.scheduling_legs?.lf_synced_snapshot?.dispatch?.aircraft?.tailNumber;
    if (tail) total += await accrueLeg(deps, fi, tail);
  }
  return total;
}
```

- [ ] **Step 6: Run the accrual + reconciler-adjacent tests**

Run: `node --test backend/src/fleet/*.test.js`
Expected: PASS (all fleet unit tests green)

- [ ] **Step 7: Commit**

```bash
git add backend/src/fleet/accrueLeg.js backend/src/fleet/accrueLeg.test.js backend/src/fleet/accrueAllCompleted.js backend/src/services/flightTrackReconciler.js backend/src/services/adsbTrack.js
git commit -m "feat(fleet): accrual wiring (flight-info -> ledger) + reconciler backfill"
```

---

## Task 10: `routes/fleet.js` + flight-info routes + mounting + permission guard

**Files:**
- Create: `backend/src/routes/fleet.js`
- Create: `backend/src/middleware/requireFlightInfoAccess.js`
- Modify: `backend/src/routes/scheduling.js` (add 3 flight-info routes)
- Modify: `backend/src/index.js` (mount `/api/fleet`)
- Test: `backend/src/middleware/requireFlightInfoAccess.test.js`

- [ ] **Step 1: Write the failing test for the permission helper**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { isCrewOnLeg } from './requireFlightInfoAccess.js';

const leg = { lf_synced_snapshot: { pilots: [{ user: { email: 'pic@x.com' }, seat: 2 }],
                                    attendants: [{ user: { email: 'fa@x.com' }, seat: 7 }] } };

test('isCrewOnLeg matches assigned pilot email (case-insensitive)', () => {
  assert.equal(isCrewOnLeg(leg, 'PIC@x.com'), true);
  assert.equal(isCrewOnLeg(leg, 'fa@x.com'), true);
  assert.equal(isCrewOnLeg(leg, 'random@x.com'), false);
});

test('isCrewOnLeg false on missing data', () => {
  assert.equal(isCrewOnLeg(null, 'pic@x.com'), false);
  assert.equal(isCrewOnLeg(leg, null), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/middleware/requireFlightInfoAccess.test.js`
Expected: FAIL — `Cannot find module './requireFlightInfoAccess.js'`

- [ ] **Step 3: Write the permission helper + middleware**

```js
// backend/src/middleware/requireFlightInfoAccess.js
import { canEditScheduling } from '../scheduling/canEdit.js';

export function isCrewOnLeg(legRow, email) {
  if (!legRow || !email) return false;
  const snap = legRow.lf_synced_snapshot || {};
  const people = [...(snap.pilots || []), ...(snap.attendants || [])];
  const e = String(email).toLowerCase();
  return people.some((p) => String(p?.user?.email || '').toLowerCase() === e);
}

// Express middleware: allow scheduling editors OR crew assigned to the leg.
// Expects req.legRow to be loaded by the route (from scheduling_legs).
export function requireFlightInfoAccess(req, res, next) {
  if (canEditScheduling(req.user?.role)) return next();
  if (isCrewOnLeg(req.legRow, req.user?.email)) return next();
  return res.status(403).json({ error: 'Not authorized to edit this flight info' });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/middleware/requireFlightInfoAccess.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Write `routes/fleet.js`**

```js
// backend/src/routes/fleet.js
import { Router } from 'express';
import { supabase } from '../services/supabase.js';
import { requireSchedulingEditor } from '../scheduling/requireSchedulingEditor.js';
import { listAircraft, getAircraft, patchAircraft } from '../fleet/aircraftStore.js';
import { listComponents, upsertComponent, applyLedgerEntry, recomputeTotals } from '../fleet/componentStore.js';
import { importFleet } from '../fleet/lfAircraftImport.js';
import * as lf from '../services/levelflight.js';
import { upsertAircraftByTail } from '../fleet/aircraftStore.js';

const router = Router();

router.get('/aircraft', async (_req, res) => res.json(await listAircraft(supabase)));

router.get('/aircraft/:idOrTail', async (req, res) => {
  const ac = await getAircraft(supabase, req.params.idOrTail);
  if (!ac) return res.status(404).json({ error: 'not found' });
  const components = await listComponents(supabase, ac.id);
  res.json({ ...ac, components });
});

router.patch('/aircraft/:id', requireSchedulingEditor, async (req, res) =>
  res.json(await patchAircraft(supabase, req.params.id, req.body || {})));

router.post('/aircraft/import', requireSchedulingEditor, async (_req, res) => {
  const result = await importFleet({
    fetchList: lf.getAircraftList, fetchDetail: lf.getAircraftDetail, fetchTimes: lf.getOtherFlightTimes,
    getExistingByTail: (tail) => getAircraft(supabase, tail),
    upsertAircraft: (row) => upsertAircraftByTail(supabase, row),
    upsertComponent: (row) => upsertComponent(supabase, row),
  });
  res.json(result);
});

router.get('/components', async (_req, res) => res.json(await listComponents(supabase)));
router.post('/aircraft/:id/components', requireSchedulingEditor, async (req, res) =>
  res.json(await upsertComponent(supabase, { ...req.body, aircraft_id: req.params.id })));
router.get('/components/:id/ledger', async (req, res) => {
  if (!supabase) return res.json([]);
  const { data } = await supabase.from('component_time_entries').select('*').eq('component_id', req.params.id).order('created_at', { ascending: false });
  res.json(data || []);
});
router.post('/components/:id/entries', requireSchedulingEditor, async (req, res) => {
  const entry = { component_id: req.params.id, source: req.body.source || 'manual',
    hours_delta: Number(req.body.hours_delta || 0), cycles_delta: Number(req.body.cycles_delta || 0),
    note: req.body.note || null, created_by: req.user?.email || null };
  await applyLedgerEntry(supabase, entry);
  res.json(await recomputeTotals(supabase, req.params.id));
});

export default router;
```

- [ ] **Step 6: Add flight-info routes to `routes/scheduling.js`**

Add near the other leg routes (reuse the existing `supabase` import in that file). Load the leg row, gate with `requireFlightInfoAccess`, and on complete trigger accrual:

```js
import { requireFlightInfoAccess } from '../middleware/requireFlightInfoAccess.js';
import { getFlightInfo, upsertFlightInfo, markComplete, prefillFromBlock } from '../scheduling/flightInfoStore.js';
import { accrueLeg } from '../fleet/accrueLeg.js';
import { getAircraft } from '../fleet/aircraftStore.js';
import { listComponents, applyLedgerEntry } from '../fleet/componentStore.js';

async function loadLeg(req, res, next) {
  if (!supabase) { req.legRow = null; return next(); }
  const { data } = await supabase.from('scheduling_legs').select('*').eq('id', req.params.legId).maybeSingle();
  req.legRow = data || null; next();
}

router.get('/legs/:legId/flight-info', loadLeg, async (req, res) => {
  let fi = await getFlightInfo(supabase, req.params.legId);
  if (!fi) fi = { scheduling_leg_id: req.params.legId, status: 'draft',
                  ...prefillFromBlock(req.legRow?.lf_synced_snapshot?.block) };
  res.json(fi);
});

router.put('/legs/:legId/flight-info', loadLeg, requireFlightInfoAccess, async (req, res) =>
  res.json(await upsertFlightInfo(supabase, req.params.legId, req.body || {})));

router.post('/legs/:legId/flight-info/complete', loadLeg, requireFlightInfoAccess, async (req, res) => {
  const fi = await markComplete(supabase, req.params.legId, req.user?.email);
  const tail = req.legRow?.lf_synced_snapshot?.dispatch?.aircraft?.tailNumber;
  if (fi && tail) {
    await accrueLeg({ getAircraftByTail: (t) => getAircraft(supabase, t),
      listComponents: (acId) => listComponents(supabase, acId),
      applyLedgerEntry: (e) => applyLedgerEntry(supabase, e) }, fi, tail);
  }
  res.json(fi);
});
```

- [ ] **Step 7: Mount the fleet router in `index.js`**

Next to the other guarded `/api/*` mounts, add:

```js
import fleetRouter from './routes/fleet.js';
// ... after auth guard is applied ...
app.use('/api/fleet', fleetRouter);
```

- [ ] **Step 8: Run the full backend suite + boot check**

Run: `node --test backend/src/fleet/*.test.js backend/src/scheduling/*.test.js backend/src/middleware/*.test.js`
Expected: PASS. Then `node -e "import('./backend/src/routes/fleet.js').then(()=>console.log('fleet route imports OK'))"`
Expected: `fleet route imports OK`

- [ ] **Step 9: Commit**

```bash
git add backend/src/routes/fleet.js backend/src/middleware/requireFlightInfoAccess.js backend/src/middleware/requireFlightInfoAccess.test.js backend/src/routes/scheduling.js backend/src/index.js
git commit -m "feat(fleet): /api/fleet + flight-info routes, crew-or-editor guard"
```

> While here, perform the **Open Question 3** empirical check: with backend env loaded, call `lf.getOtherFlightTimes()` once (or re-run the probe) and confirm the per-component shape; adjust `applyBaselineTimes` keys in `lfAircraftImport.js` if needed, with a follow-up commit.

---

## Task 11: Frontend — Fleet area (list, detail, components)

**Files:**
- Create: `frontend/src/pages/fleet/FleetAircraftList.jsx`, `FleetAircraftDetail.jsx`, `FleetComponents.jsx`
- Create: `frontend/src/components/fleet/AircraftBasicInfoForm.jsx`, `AircraftPerformanceForm.jsx`, `ComponentList.jsx`, `AddComponentModal.jsx`, `ComponentLedger.jsx`
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Add routes** in `App.jsx` under the authed area (match the existing `/scheduling/*` registration style):

```jsx
<Route path="/fleet" element={<FleetAircraftList />} />
<Route path="/fleet/aircraft/:tail" element={<FleetAircraftDetail />} />
<Route path="/fleet/components" element={<FleetComponents />} />
```

- [ ] **Step 2: Build `FleetAircraftList.jsx`** — `apiFetch('/api/fleet/aircraft')`, render a dark table/cards (tail, type, base, pax seats, active), an "Import from LevelFlight" button (`POST /api/fleet/aircraft/import`, then refetch), and an "Add Aircraft" affordance. Row click → `/fleet/aircraft/:tail`. Use inline styles + CSS vars like existing pages (reference `frontend/src/pages/scheduling/Aircraft.jsx`).

- [ ] **Step 3: Build `FleetAircraftDetail.jsx`** — fetch `/api/fleet/aircraft/:tail`; sub-nav **Basic Info · Performance · Components**. Basic Info → `AircraftBasicInfoForm` (all `aircraft` basic fields, PATCH on save). Performance → `AircraftPerformanceForm` (cruise/fuel-burn/limits, PATCH on save). Components → `ComponentList` (rows with current `total_hours`/`total_cycles`, baseline, + `AddComponentModal`, + `ComponentLedger` view per component, + a manual-entry form POSTing `/api/fleet/components/:id/entries`).

- [ ] **Step 4: Build `FleetComponents.jsx`** — `apiFetch('/api/fleet/components')`, fleet-wide table (Tail, Type, Serial, Model, Manufacturer, Note, Hours, Cycles) mirroring LF's Components view, with Add Component.

- [ ] **Step 5: Verify build**

Run: `cd frontend && npm run build`
Expected: build succeeds (no unresolved imports / JSX errors).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/fleet frontend/src/components/fleet frontend/src/App.jsx
git commit -m "feat(fleet): Fleet pages (aircraft list/detail, components, ledger)"
```

---

## Task 12: Frontend — Flight Info tab in trip detail

**Files:**
- Create: `frontend/src/components/scheduling/FlightInfoTab.jsx`
- Modify: `frontend/src/pages/SchedulingTripDetail.jsx` (register the tab — single-line addition to the tab list + one render branch)

- [ ] **Step 1: Build `FlightInfoTab.jsx`** — props `{ legId }` (or a leg selector when the trip has multiple legs). `GET /api/scheduling/legs/:legId/flight-info` to load (already pre-filled server-side from LF block). Render the post-flight form: OOOI datetime inputs (show computed Actual Flight = On−Off and Actual Block = In−Out via `minutesToHhmm` from `lib/flightTime.js`), Time of Day, Fuel start/stop, APU start/stop/end-cycles, Engine #1/#2 oil, Delay Reason, Approach Type, PIC/SIC blocks (performed takeoff/landing, IMC, Night), Debrief (category + notes), Attachments (reuse existing scheduling document upload). Buttons: **Save** (`PUT …/flight-info`) and **Mark Complete** (`POST …/flight-info/complete`, then refetch). Mobile-friendly single-column layout.

- [ ] **Step 2: Register the tab** in `SchedulingTripDetail.jsx` — add `'Flight Info'` to the tab list and a render branch `{activeTab === 'Flight Info' && <FlightInfoTab legId={selectedLegId} />}`. Keep the diff to these two minimal edits.

- [ ] **Step 3: Verify build**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/scheduling/FlightInfoTab.jsx frontend/src/pages/SchedulingTripDetail.jsx
git commit -m "feat(fleet): pilot Flight Info tab (post-flight OOOI entry)"
```

---

## Task 13: Update CLAUDE.md + full verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md** (standing rule) — add to the relevant sections:
  - §3 migrations list → `022_fleet.sql`
  - §6 → note `fleet.js` is superseded by the `aircraft` table (keep `fleet.js` as fallback until callers migrate)
  - §9/§17 → the reconciler now runs a best-effort component-accrual pass
  - §18 schema → `aircraft`, `aircraft_components`, `component_time_entries`, `flight_info`, `flight_info_crew`
  - §19 routes → `routes/fleet.js` (`/api/fleet`) + `/api/scheduling/legs/:legId/flight-info`
  - §20 frontend → `/fleet/*` pages + the Flight Info trip-detail tab
  - §24 → new invariant: component totals = baseline + Σ ledger; accrual is idempotent per (component, leg); engines/airframe Off→On, APU from start/stop + running-total cycles

- [ ] **Step 2: Run the complete test + build verification**

Run:
```
node --test backend/src/fleet/*.test.js backend/src/scheduling/*.test.js backend/src/services/*.test.js backend/src/middleware/*.test.js frontend/src/lib/flightTime.test.js
cd frontend && npm run build
```
Expected: all tests PASS; build succeeds. Record counts.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(fleet): update CLAUDE.md for fleet profiles, components, flight info"
```

- [ ] **Step 4: Final summary to the user** — list what shipped, remind them migration `022_fleet.sql` must be applied in Supabase, then they can hit "Import from LevelFlight" on `/fleet`. Note the Open-Question-3 endpoint shape was confirmed/adjusted in Task 10. Do **not** push until the user reviews the diff (per the review-before-push rule).

---

## Self-review (against the spec)

- **§4 data model** → Task 1 (all five tables, exact columns incl. `apu_last_reading` for running-total cycles).
- **§5 LF import** incl. `/all`→`/list` correction + `locally_modified` respect → Tasks 3, 7.
- **§6 accrual** (Off→On engines+airframe, APU start/stop + running-total cycle delta, baseline-date filter, idempotency, upgrade) → Tasks 4, 6, 9; APU running-total via `apu_last_reading`.
- **§7 API** (aircraft/components/ledger + flight-info) → Tasks 10.
- **§8 permissions** (crew-or-editor) → Task 10 (`requireFlightInfoAccess`).
- **§9 frontend** (Fleet area + Flight Info tab) → Tasks 11, 12; `lib/flightTime` → Task 2.
- **§10 testing** → unit tests in Tasks 2–10; build checks Tasks 11–13.
- **§11 rollout** (manual migration, soft-fail, CLAUDE.md) → Tasks 1, 13.
- **§12 resolved decisions** → airframe Off→On (Task 4), APU running-total (`apu_last_reading`, Tasks 1/4/7), baseline auto-import + manual fallback (Tasks 7/10).

Type consistency: ledger entry shape `{component_id, source, leg_id, hours_delta, cycles_delta, time_source}` is identical across `computeLegEntries` (Task 4), `applyLedgerEntry` (Task 6), and `accrueLeg` (Task 9). `totalsFromEntries` / `recomputeTotals` names consistent. `normReg` reused (exported if needed, Task 9). No placeholders.
