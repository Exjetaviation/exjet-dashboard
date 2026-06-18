# Scheduling LevelFlight Mappers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure mapping layer that turns LevelFlight's `/api/analytics/scheduledLegs` response into the three operational entities our schema stores (trips, legs, crew assignments), shaped for the existing reconcile engine — fully unit-tested offline.

**Architecture:** Part of Slice 1 of the scheduling-dispatcher-web sub-project (spec: `docs/superpowers/specs/2026-06-18-scheduling-dispatcher-web-design.md`). Two new pure modules in `backend/src/scheduling/`: `lfNormalize.js` (ObjectId / timestamp / list-unwrap helpers, ported verbatim from the proven `~/exjet-ingest/ingest.ts` ETL) and `mapScheduledLegs.js` (the LevelFlight→schema mapper). Both are pure (no I/O) so they're exhaustively testable before any network/database wiring. The mapper emits records in the `{ lfOid, values, snapshot }` shape that `reconcileBatch` already consumes, plus a `ref` carrying a parent's `lf_oid` for the orchestrator (next plan) to resolve into a uuid foreign key.

**Tech Stack:** Node 20 (ESM), `node:test` + `node:assert/strict`, co-located `*.test.js`. Run tests from the repo root with `node --test backend/src/scheduling/*.test.js` (Node 25 needs the glob, not a bare directory).

**Scope note:** `scheduledLegs` carries trips, legs, and crew, but only a passenger *count* — not the manifest. Passengers (names/DOB/weight) come from a dispatch-detail endpoint and are **deferred** to a later slice. Legs in our schema have **no status column** (status lives on the trip), so the leg mapper does not emit one.

---

## File Structure

- `backend/src/scheduling/lfNormalize.js` — **new.** Pure: `oidToStr`, `toIsoTimestamp`, `unwrapArray`. Ported from `~/exjet-ingest/ingest.ts`.
- `backend/src/scheduling/lfNormalize.test.js` — **new.** Unit tests.
- `backend/src/scheduling/mapScheduledLegs.js` — **new.** Pure: `mapScheduledLegs(rawLegs)` → `{ trips, legs, crew }`.
- `backend/src/scheduling/mapScheduledLegs.test.js` — **new.** Unit tests against a synthetic fixture matching the real LevelFlight shape.

---

### Task 1: LevelFlight normalize helpers

**Files:**
- Create: `backend/src/scheduling/lfNormalize.test.js`
- Create: `backend/src/scheduling/lfNormalize.js`

- [ ] **Step 1: Write the failing test.** Create `backend/src/scheduling/lfNormalize.test.js`:

```js
// backend/src/scheduling/lfNormalize.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oidToStr, toIsoTimestamp, unwrapArray } from './lfNormalize.js';

test('oidToStr handles EJSON $oid, strings, numbers, and empties', () => {
  assert.equal(oidToStr({ $oid: 'abc123' }), 'abc123');
  assert.equal(oidToStr('plain'), 'plain');
  assert.equal(oidToStr(42), '42');
  assert.equal(oidToStr(null), null);
  assert.equal(oidToStr(undefined), null);
  assert.equal(oidToStr({}), null);
});

test('toIsoTimestamp handles ms, sec, ISO, numeric strings, Date, and junk', () => {
  const ms = 1765207800000;
  const expected = new Date(ms).toISOString();
  assert.equal(toIsoTimestamp(ms), expected);
  assert.equal(toIsoTimestamp(ms / 1000), expected);            // seconds upscaled to ms
  assert.equal(toIsoTimestamp(String(ms)), expected);            // numeric string
  assert.equal(toIsoTimestamp('2026-06-18T19:00:00.000Z'), '2026-06-18T19:00:00.000Z');
  assert.equal(toIsoTimestamp(new Date(ms)), expected);
  assert.equal(toIsoTimestamp(null), null);
  assert.equal(toIsoTimestamp(''), null);
  assert.equal(toIsoTimestamp('not-a-date'), null);
});

test('unwrapArray returns bare arrays and unwraps known keys', () => {
  assert.deepEqual(unwrapArray([1, 2], ['legs']), [1, 2]);
  assert.deepEqual(unwrapArray({ legs: [3] }, ['legs', 'data']), [3]);
  assert.throws(() => unwrapArray({ nope: 1 }, ['legs']), /unexpected LevelFlight list shape/);
});
```

- [ ] **Step 2: Run the test to verify it fails.** Run: `node --test backend/src/scheduling/lfNormalize.test.js` — Expected: FAIL, cannot find module `./lfNormalize.js`.

- [ ] **Step 3: Write the implementation.** Create `backend/src/scheduling/lfNormalize.js`:

```js
// backend/src/scheduling/lfNormalize.js
//
// Pure normalizers for LevelFlight payloads, ported from the proven exjet-ingest
// ETL. LevelFlight returns Mongo-style EJSON (`{ $oid }`) and timestamps in mixed
// forms (epoch ms, epoch sec, ISO strings, numeric strings). These turn them into
// plain strings / ISO timestamps for our Postgres columns.

// Extract an ObjectId string from LevelFlight's many id shapes.
export function oidToStr(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object' && typeof v.$oid === 'string') return v.$oid;
  return null;
}

// Convert a LevelFlight timestamp to an ISO string safe for a timestamptz column.
// Accepts epoch ms, epoch sec, ISO strings, numeric strings, and Date objects.
// Returns null when absent or unparseable.
export function toIsoTimestamp(v) {
  if (v === null || v === undefined) return null;

  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    if (s.includes('T') || s.includes('-') || s.includes(':')) {
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    if (/^\d+$/.test(s)) return toIsoTimestamp(Number(s));
    return null;
  }

  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    let ms = v;
    if (v > 0 && v < 1e11) ms = v * 1000; // likely seconds, not ms
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  if (v instanceof Date) {
    return isNaN(v.getTime()) ? null : v.toISOString();
  }

  return null;
}

// Unwrap a LevelFlight list response that may be a bare array or wrapped under a
// known key (e.g. { legs: [...] }). Throws on an unexpected shape.
export function unwrapArray(payload, keys) {
  if (Array.isArray(payload)) return payload;
  for (const k of keys) {
    if (Array.isArray(payload?.[k])) return payload[k];
  }
  throw new Error('unexpected LevelFlight list shape: ' + JSON.stringify(payload).slice(0, 300));
}
```

- [ ] **Step 4: Run the test to verify it passes.** Run: `node --test backend/src/scheduling/lfNormalize.test.js` — Expected: PASS, all 3 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add backend/src/scheduling/lfNormalize.js backend/src/scheduling/lfNormalize.test.js
git commit -m "feat(scheduling): LevelFlight oid/timestamp normalize helpers"
```

---

### Task 2: scheduledLegs → trips/legs/crew mapper

**Files:**
- Create: `backend/src/scheduling/mapScheduledLegs.test.js`
- Create: `backend/src/scheduling/mapScheduledLegs.js`

- [ ] **Step 1: Write the failing test.** Create `backend/src/scheduling/mapScheduledLegs.test.js`:

```js
// backend/src/scheduling/mapScheduledLegs.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapScheduledLegs } from './mapScheduledLegs.js';

// Two legs of one round-trip dispatch, shaped like real /api/analytics/scheduledLegs.
const dispatch = {
  _id: { $oid: 'disp1' },
  tripId: 25104,
  status: 'booked',
  aircraft: { _id: { $oid: 'acN69' }, tailNumber: 'N69FP' },
  client: { company: { _id: { $oid: 'co1' } }, customer: { _id: { $oid: 'cust1' } } },
};
const pilots = [
  { seat: 2, user: { _id: { $oid: 'pilotPIC' } } },
  { seat: 3, user: { _id: { $oid: 'pilotSIC' } } },
];
const legOut = {
  _id: { $oid: 'legB' }, status: 'booked', dispatch, pilots,
  departure: { airport: 'TJSJ', time: 1765290600000 },
  arrival: { airport: 'KFXE', time: 1765305000000 },
};
const legBack = {
  _id: { $oid: 'legA' }, status: 'booked', dispatch, pilots,
  departure: { airport: 'KFXE', time: 1765207800000 }, // earlier than legB
  arrival: { airport: 'TJSJ', time: 1765222200000 },
};

test('mapScheduledLegs dedupes the trip and maps its fields', () => {
  const { trips } = mapScheduledLegs([legOut, legBack]);
  assert.equal(trips.length, 1);
  assert.equal(trips[0].lfOid, 'disp1');
  assert.deepEqual(trips[0].values, {
    status: 'booked',
    trip_number: '25104',
    aircraft_lf_oid: 'acN69',
    company_lf_oid: 'co1',
    customer_lf_oid: 'cust1',
  });
});

test('mapScheduledLegs maps legs and orders seq by departure time', () => {
  const { legs } = mapScheduledLegs([legOut, legBack]);
  assert.equal(legs.length, 2);
  const a = legs.find((x) => x.lfOid === 'legA');
  const b = legs.find((x) => x.lfOid === 'legB');
  assert.equal(a.values.dep_icao, 'KFXE');
  assert.equal(a.values.arr_icao, 'TJSJ');
  assert.equal(a.values.dep_time, new Date(1765207800000).toISOString());
  assert.equal(a.values.seq, 0);            // earlier departure
  assert.equal(b.values.seq, 1);
  assert.equal(a.ref.tripLfOid, 'disp1');
  assert.equal('status' in a.values, false); // legs carry no status column
});

test('mapScheduledLegs maps PIC/SIC crew with composite ids and leg refs', () => {
  const { crew } = mapScheduledLegs([legBack]);
  assert.equal(crew.length, 2);
  const pic = crew.find((c) => c.values.seat === 'PIC');
  assert.equal(pic.lfOid, 'legA:PIC');
  assert.equal(pic.values.crew_lf_oid, 'pilotPIC');
  assert.equal(pic.ref.legLfOid, 'legA');
  assert.ok(crew.some((c) => c.values.seat === 'SIC' && c.values.crew_lf_oid === 'pilotSIC'));
});

test('mapScheduledLegs skips a leg with no dispatch id', () => {
  const orphan = { _id: { $oid: 'legX' }, departure: { airport: 'KFXE' } };
  const { trips, legs } = mapScheduledLegs([orphan]);
  assert.equal(trips.length, 0);
  assert.equal(legs.length, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails.** Run: `node --test backend/src/scheduling/mapScheduledLegs.test.js` — Expected: FAIL, cannot find module `./mapScheduledLegs.js`.

- [ ] **Step 3: Write the implementation.** Create `backend/src/scheduling/mapScheduledLegs.js`:

```js
// backend/src/scheduling/mapScheduledLegs.js
//
// Pure mapper: LevelFlight /api/analytics/scheduledLegs returns an array of legs,
// each carrying its parent dispatch (trip) and embedded crew. Turn that into our
// three operational entities. Field-path fallbacks mirror the proven exjet-ingest
// ETL.
//
// Returns { trips, legs, crew }, each an array of records shaped for
// reconcileBatch: { lfOid, values, snapshot, [ref] }. `values` holds only real
// columns; `ref` carries a parent's lf_oid for the orchestrator to resolve into a
// uuid FK before upserting.
import { oidToStr, toIsoTimestamp } from './lfNormalize.js';

function legOidOf(l) {
  return oidToStr(l?._id?.$oid) || oidToStr(l?._id) || oidToStr(l?.oid) || oidToStr(l?.id);
}
function dispatchOidOf(l) {
  return (
    oidToStr(l?.dispatch?._id?.$oid) || oidToStr(l?.dispatch?._id) ||
    oidToStr(l?.dispatch?.oid) || oidToStr(l?.dispatch?.id) ||
    oidToStr(l?.dispatchOid) || oidToStr(l?.dispatch_id) || null
  );
}
function aircraftOidOf(l) {
  return (
    oidToStr(l?.dispatch?.aircraft?._id?.$oid) || oidToStr(l?.dispatch?.aircraft?._id) ||
    oidToStr(l?.dispatch?.aircraft?.oid) || oidToStr(l?.dispatch?.aircraft?.id) ||
    oidToStr(l?.aircraft?._id?.$oid) || oidToStr(l?.aircraft?._id) || null
  );
}
function depIcaoOf(l) {
  return l?.departure?.airport || l?.departureAirport || l?.from || l?.dep ||
    l?.dep_icao || l?.depIcao || l?._calc?.from?.icao || l?._calc?.from?.airport || null;
}
function arrIcaoOf(l) {
  return l?.arrival?.airport || l?.arrivalAirport || l?.to || l?.arr ||
    l?.arr_icao || l?.arrIcao || l?._calc?.to?.icao || l?._calc?.to?.airport || null;
}
function depTimeOf(l) {
  return toIsoTimestamp(l?.dep_time) || toIsoTimestamp(l?.etd) || toIsoTimestamp(l?.scheduledETD) ||
    toIsoTimestamp(l?.departureTime) || toIsoTimestamp(l?.departure?.time) || toIsoTimestamp(l?.block?.out) || null;
}
function arrTimeOf(l) {
  return toIsoTimestamp(l?.arr_time) || toIsoTimestamp(l?.eta) || toIsoTimestamp(l?.scheduledETA) ||
    toIsoTimestamp(l?.arrivalTime) || toIsoTimestamp(l?.arrival?.time) || toIsoTimestamp(l?.block?.in) || null;
}

export function mapScheduledLegs(rawLegs) {
  const tripsByOid = new Map();
  const legRecords = [];
  const crewRecords = [];

  for (const l of rawLegs || []) {
    const legOid = legOidOf(l);
    const dispatchOid = dispatchOidOf(l);
    if (!legOid || !dispatchOid) continue; // can't place a leg without its trip

    // Trip — deduped; first leg seen wins for trip-level fields.
    if (!tripsByOid.has(dispatchOid)) {
      const d = l.dispatch || {};
      tripsByOid.set(dispatchOid, {
        lfOid: dispatchOid,
        values: {
          status: d.status ?? l.status ?? null,
          trip_number: d.tripId != null ? String(d.tripId) : null,
          aircraft_lf_oid: aircraftOidOf(l),
          company_lf_oid: oidToStr(d?.client?.company?._id?.$oid) || oidToStr(d?.client?.company?._id) || null,
          customer_lf_oid: oidToStr(d?.client?.customer?._id?.$oid) || oidToStr(d?.client?.customer?._id) || null,
        },
        snapshot: d,
      });
    }

    // Leg — note: no status column in our schema (status lives on the trip).
    legRecords.push({
      lfOid: legOid,
      values: {
        dep_icao: depIcaoOf(l),
        arr_icao: arrIcaoOf(l),
        dep_time: depTimeOf(l),
        arr_time: arrTimeOf(l),
      },
      snapshot: l,
      ref: { tripLfOid: dispatchOid },
    });

    // Crew — first PIC (seat 2) and first SIC (seat 3) per leg.
    const pilots = (Array.isArray(l?.pilots) && l.pilots) || (Array.isArray(l?.crew?.pilots) && l.crew.pilots) || [];
    const seenSeat = new Set();
    for (const p of pilots) {
      const u = p?.user || p?.pilot || p?.crew || p;
      const crewOid = oidToStr(u?._id?.$oid) || oidToStr(u?._id) || oidToStr(u?.oid) || oidToStr(u?.id);
      const seatNum = p?.seat ?? p?.position ?? null;
      const seat = seatNum === 2 ? 'PIC' : seatNum === 3 ? 'SIC' : null;
      if (!crewOid || !seat || seenSeat.has(seat)) continue;
      seenSeat.add(seat);
      crewRecords.push({
        lfOid: `${legOid}:${seat}`,
        values: { crew_lf_oid: crewOid, seat },
        snapshot: { crew_lf_oid: crewOid, seat },
        ref: { legLfOid: legOid },
      });
    }
  }

  // Per-trip leg sequence, ordered by departure time.
  const byTrip = new Map();
  for (const leg of legRecords) {
    const t = leg.ref.tripLfOid;
    if (!byTrip.has(t)) byTrip.set(t, []);
    byTrip.get(t).push(leg);
  }
  for (const group of byTrip.values()) {
    group.sort((a, b) => String(a.values.dep_time ?? '').localeCompare(String(b.values.dep_time ?? '')));
    group.forEach((leg, i) => { leg.values.seq = i; });
  }

  return { trips: Array.from(tripsByOid.values()), legs: legRecords, crew: crewRecords };
}
```

- [ ] **Step 4: Run the test to verify it passes.** Run: `node --test backend/src/scheduling/mapScheduledLegs.test.js` — Expected: PASS, all 4 tests pass.

- [ ] **Step 5: Run the whole scheduling suite.** Run: `node --test backend/src/scheduling/*.test.js` — Expected: PASS (existing reconcile/freshness tests plus the new normalize/mapper tests).

- [ ] **Step 6: Commit.**

```bash
git add backend/src/scheduling/mapScheduledLegs.js backend/src/scheduling/mapScheduledLegs.test.js
git commit -m "feat(scheduling): map scheduledLegs into trips/legs/crew"
```

---

## Next plan (not in scope here)

The orchestrator plan wires these mappers to the world: a sync job that calls `lfPost('/api/analytics/scheduledLegs', { start })` over month buckets across the −30/+90d window (reuse `lfGet`/`lfPost` from `backend/src/agent/providers/levelflight.js`), maps with `mapScheduledLegs`, resolves `ref.tripLfOid`/`ref.legLfOid` into uuid FKs, runs `reconcileBatch`, upserts in FK order (trips → legs → crew), and records `scheduling_sync_status`. Then a `startSyncWorker()` (setInterval, ~every few minutes, mirroring `startReconciler`) wired into `backend/src/index.js`, and a `GET /api/scheduling/sync-status` route using `freshnessLabel`. Apply the sticky-`upstream_changed` refinement noted in the foundation plan. Passengers (dispatch-detail endpoint) follow after.
