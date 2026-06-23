# Quoting → Dispatch Revamp — Phase D2 (Native Trip Sheet) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the crew **trip sheet** (flight release) render from a NATIVE trip (uuid), reusing the tested `mapReleaseLeg` + `mapManifest` and the Midnight renderer unchanged. Per the user's decisions, the LF-only sections are **omitted** (maintenance, METAR, fuel burn, per-leg comms/elevation/timezone), the operator block uses **Exjet constants** (cert blank, Part derived from Purpose), crew shows **names only**, and the aircraft block shows **tail/type/seats**.

**Architecture:** A new `nativeTripSheetData.js` builds the trip-sheet VM from `scheduling_trips`+`scheduling_legs`+`scheduling_passengers`/`scheduling_people`. It **synthesizes each native leg into the LF release-leg shape** (`_calc` from `airportName`/`airportCoord`/`legMinutes`; `passengers[]` from the manifest; `dispatch.purpose` from the trip Purpose so `legFlightType` resolves Part 91/135), then **reuses `mapReleaseLeg`** (with an empty `empById` → crew dob/phone null) and `mapManifest`. Omitted fields fall to `null` naturally (the mappers `??`-guard them); `maintenance: null` makes the renderer skip that block. The `/api/tripsheet/:id` route branches **uuid → native**. Renderers untouched.

**Tech Stack:** Node + Express, `node:test`, Supabase. Backend test from `backend/`: `node --test src/services/*.test.js`. Import smoke for the route.

**Phase context:** D2 of Phase D (native docs). Depends on D1 (merged) + C3 (FBO on snapshot) + the Crew tab (crew on snapshot). The trip sheet is **authenticated** (`/api/tripsheet`, behind the `/api` guard) — not public like the itinerary. Frontend `SchedulingTripSheet.jsx` (`/scheduling/trips/:id/sheet`) calls `GET /api/tripsheet/:id`, so branching that route covers both the modal view and the `/sheet` page.

**Reference:** the D1 pattern (`nativeItineraryData.js` `toLfLeg` + reuse of `mapItineraryLeg`). `tripSheet.js` exports `mapReleaseLeg(r, empById, paxById, tripManifest)`, `mapManifest(pax)`, `flightType`/`legFlightType`. Operator address (from the quote doc): `4250 Execuair Street, Suite G, Orlando, FL 32827`.

---

## File Structure

**Create:**
- `backend/src/services/nativeTripSheetData.js` — `paxToLf` (pure), `toReleaseLeg` (pure), `buildNativeTripSheetVM(tripId)`.
- `backend/src/services/nativeTripSheetData.test.js` — tests `mapReleaseLeg(toReleaseLeg(...))` + `mapManifest(paxToLf(...))`.

**Modify:**
- `backend/src/routes/tripSheet.js` — branch `/:id` + `/:id/pdf` uuid→native.

---

## Task 1: Native trip-sheet VM builder

**Files:** Create `backend/src/services/nativeTripSheetData.js` + `.test.js`.

Key facts (verified): `mapReleaseLeg(r, empById, paxById, tripManifest)` reads `r.pilots/attendants`, `r.passengers` (lead via `leadUserId`, per-leg manifest joined via `paxById` keyed by `oid(user._id)`, falls back to `tripManifest` when paxCount>0 but no explicit list), `r.departure/arrival.{airport,time,fbo}`, `r._calc.{from,to}.{name,location,elevation,timezone,comms}`, `r._calc.{distance.value,minutes,time,fuel.value}`, `r.weather.{departure,arrival}.raw`, `legFlightType(r)` (uses `r.purpose`/`r.dispatch.purpose`; `PURPOSE_91 = {…,8:'Owner',…}`, anything else → 135). `mapManifest(pax)` → `paxRow(p)` reads `p._fullName||firstName+lastName`, `p.gender`, `p.weight`, `p.birthday`, `p.citizenship`, `p.documents[0].{number,country}`. Helpers: `airportName`, `airportCoord`, `aircraftInfo`, `legMinutes` (as in D1). Native leg snapshot has `departure/arrival.{time,fbo}`, `pilots/attendants`, `passengerCount`, `isPositioning`, `dispatch.aircraft.tailNumber`.

- [ ] **Step 1: Write the failing test** (`nativeTripSheetData.test.js`) — exercises the pure builders through the real `mapReleaseLeg`/`mapManifest`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paxToLf, toReleaseLeg } from './nativeTripSheetData.js';
import { mapReleaseLeg, mapManifest } from './tripSheet.js';

const people = [
  { person_id: 'x1', seat: '1', first_name: 'John', last_name: 'Carter', dob: '1971-04-02', gender: 'M', weight_lbs: 185, citizenship: 'USA', passport_number: 'P123', passport_country: 'USA' },
  { person_id: 'x2', seat: '2', first_name: 'Emily', last_name: 'Carter', dob: '1974-09-15', gender: 'F', weight_lbs: 140, citizenship: 'USA', passport_number: null, passport_country: null },
];
const lfPax = paxToLf(people);
const legPassengers = lfPax.map((p) => ({ user: { _id: p._id }, seat: p.seat }));
const snap = {
  passengerCount: 2, isPositioning: false,
  departure: { time: Date.parse('2026-07-01T12:00:00Z'), fbo: { name: 'BANYAN AIR SERVICE', address: { city: 'FORT LAUDERDALE' }, phones: ['800-200-2031'], comms: { arinc: '129.85' } } },
  arrival: { time: Date.parse('2026-07-01T14:13:00Z'), fbo: null },
  pilots: [{ seat: 2, user: { _id: 'p1', firstName: 'Mike', lastName: 'Reyes' } }, { seat: 3, user: { _id: 'p2', firstName: 'Dave', lastName: 'Cohen' } }],
  attendants: [{ user: { _id: 'a1', firstName: 'Lauren', lastName: 'Pierce' } }],
};
const legRow = { dep_icao: 'KFXE', arr_icao: 'KTEB', dep_time: '2026-07-01T12:00:00Z', arr_time: '2026-07-01T14:13:00Z', lf_synced_snapshot: snap };

test('paxToLf + mapManifest yields the manifest rows', () => {
  const m = mapManifest(lfPax);
  assert.equal(m[0].name, 'John Carter');
  assert.equal(m[0].weight, 185);
  assert.equal(m[0].passport, 'P123 - USA');
  assert.equal(m[1].passport, null); // no passport
});

test('toReleaseLeg → mapReleaseLeg: charter leg, LF-only fields null', () => {
  const paxById = new Map(lfPax.map((p) => [p._id, { name: [p.firstName, p.lastName].join(' '), gender: p.gender, weight: p.weight, dob: p.birthday, citizenship: p.citizenship, passport: p.documents[0] ? `${p.documents[0].number} - ${p.documents[0].country}` : null }]));
  const r = mapReleaseLeg(toReleaseLeg(legRow, { minutes: 133, distanceNm: 932 }, legPassengers, 'charter'), new Map(), paxById, mapManifest(lfPax));
  assert.equal(r.from, 'KFXE');
  assert.equal(r.toName, 'Teterboro Airport');
  assert.equal(r.distance, 932);
  assert.equal(r.minutes, 133);
  assert.equal(r.eft, '2:13');
  assert.equal(r.flightType.part, 135);            // charter
  assert.equal(r.crew.pic.name, 'Mike Reyes');
  assert.equal(r.crew.pic.dob, null);              // names-only (empty empById)
  assert.equal(r.depFbo.name, 'BANYAN AIR SERVICE');
  assert.equal(r.manifest[0].name, 'John Carter'); // lead = seat 1
  assert.equal(r.manifest[0].lead, true);
  assert.equal(r.fromElev, null);                  // omitted
  assert.equal(r.depComms, null);                  // omitted
  assert.equal(r.depMetar, null);                  // omitted
  assert.equal(r.fuelBurn, null);                  // omitted
});

test('toReleaseLeg: owner trip → Part 91', () => {
  const r = mapReleaseLeg(toReleaseLeg(legRow, { minutes: 100, distanceNm: 400 }, legPassengers, 'owner'), new Map(), new Map(), []);
  assert.equal(r.flightType.part, 91);
});
```

- [ ] **Step 2: Run it — FAIL** (`Cannot find module './nativeTripSheetData.js'`).
Run: `cd backend && node --test src/services/nativeTripSheetData.test.js`

- [ ] **Step 3: Implement** `nativeTripSheetData.js`:

```js
import { supabase } from './supabase.js';
import { mapReleaseLeg, mapManifest } from './tripSheet.js';
import { airportName } from '../scheduling/airportNames.js';
import { airportCoord } from '../scheduling/airports.js';
import { aircraftInfo } from '../scheduling/fleet.js';
import { legMinutes } from '../scheduling/priceQuote.js';

const EXJET_OPERATOR = { name: 'EXJET AVIATION', address: '4250 Execuair Street, Suite G, Orlando, FL 32827' };
const eftStr = (mins) => { const m = Math.round(mins || 0); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

// Pure: map native passenger rows (scheduling_passengers ⋈ scheduling_people) into the
// LF pax shape that mapManifest/paxRow + paxById consume.
export const paxToLf = (rows) => (rows || []).map((p) => ({
  _id: p.person_id,
  firstName: p.first_name, lastName: p.last_name,
  gender: p.gender || null,
  weight: p.weight_lbs ?? null,
  birthday: p.dob ?? null,
  citizenship: p.citizenship || null,
  documents: p.passport_number ? [{ number: p.passport_number, country: p.passport_country }] : [],
  seat: (p.seat != null && p.seat !== '' && !Number.isNaN(Number(p.seat))) ? Number(p.seat) : null,
}));

// Pure: synthesize the LF release-leg shape that mapReleaseLeg consumes. _calc carries
// only what native has (names/coords/distance/minutes/eft); elevation/timezone/comms +
// weather (METAR) + fuel are intentionally absent → mapReleaseLeg yields null for them.
// dispatch.purpose drives legFlightType: owner → 91, else 135.
export const toReleaseLeg = (legRow, time, legPassengers, purpose) => {
  const snap = legRow.lf_synced_snapshot || {};
  const depC = airportCoord(legRow.dep_icao), arrC = airportCoord(legRow.arr_icao);
  const hasPax = (snap.passengerCount || 0) > 0 && !snap.isPositioning;
  return {
    callSign: null,
    purpose: null,
    dispatch: { purpose: purpose === 'owner' ? 8 : 7 }, // 8=Owner→Part91; 7=charter→Part135
    departure: { airport: legRow.dep_icao || null, time: snap.departure?.time ?? (legRow.dep_time ? Date.parse(legRow.dep_time) : null), fbo: snap.departure?.fbo || null },
    arrival: { airport: legRow.arr_icao || null, time: snap.arrival?.time ?? (legRow.arr_time ? Date.parse(legRow.arr_time) : null), fbo: snap.arrival?.fbo || null },
    _calc: {
      from: { name: airportName(legRow.dep_icao), location: depC ? { lat: depC.lat, lng: depC.lng } : null },
      to: { name: airportName(legRow.arr_icao), location: arrC ? { lat: arrC.lat, lng: arrC.lng } : null },
      distance: { value: time?.distanceNm ?? null },
      minutes: time?.minutes ?? null,
      time: time ? eftStr(time.minutes) : null,
    },
    passengers: hasPax ? legPassengers : [],
    passengerCount: hasPax ? legPassengers.length : 0,
    pilots: snap.pilots || [],
    attendants: snap.attendants || [],
    weather: null,
    releasedBy: null,
    crewNote: null,
  };
};

// Build the crew trip-sheet VM for a NATIVE trip (uuid). Same shape as
// tripSheet.buildCrewTripSheet, so renderTripSheetHtml renders identically; the
// omitted (LF-only) sections render blank, maintenance is skipped.
export async function buildNativeTripSheetVM(tripId) {
  const { data: trip, error } = await supabase
    .from('scheduling_trips').select('id, quote_number, trip_number, company_name, contact, purpose').eq('id', tripId).single();
  if (error || !trip) return null;
  const { data: legRows } = await supabase
    .from('scheduling_legs').select('dep_icao, arr_icao, dep_time, arr_time, lf_synced_snapshot, seq').eq('trip_id', tripId).order('seq');
  const rows = legRows || [];
  if (!rows.length) return null;
  const { data: paxRows } = await supabase
    .from('scheduling_passengers').select('seat, person_id, person:scheduling_people(first_name, last_name, dob, gender, citizenship, weight_lbs, passport_number, passport_country)').eq('trip_id', tripId);
  const lfPax = paxToLf((paxRows || []).map((p) => ({ person_id: p.person_id, seat: p.seat, ...p.person })));
  const legPassengers = lfPax.map((p) => ({ user: { _id: p._id }, seat: p.seat }));
  const tripManifest = mapManifest(lfPax);
  const paxById = new Map();
  for (const lp of lfPax) paxById.set(lp._id, mapManifest([lp])[0]);

  const tail = rows[0]?.lf_synced_snapshot?.dispatch?.aircraft?.tailNumber || null;
  const { type, maxPax } = aircraftInfo(tail);
  const times = await legMinutes(null, rows.map((l) => ({ dep_icao: l.dep_icao, arr_icao: l.arr_icao })));
  const legs = rows.map((l, i) => mapReleaseLeg(toReleaseLeg(l, times[i], legPassengers, trip.purpose), new Map(), paxById, tripManifest));

  const totalDist = legs.reduce((s, l) => s + (l.distance || 0), 0);
  const totalMin = legs.reduce((s, l) => s + (l.minutes || 0), 0);
  const route = legs.map((l) => l.from).concat(legs[legs.length - 1].to).filter(Boolean).join(', ');

  return {
    dispatchId: tripId,
    tripNumber: trip.trip_number != null ? String(trip.trip_number) : null,
    quoteNumber: trip.quote_number != null ? String(trip.quote_number) : null,
    routeSummary: route || null,
    operator: { name: EXJET_OPERATOR.name, address: EXJET_OPERATOR.address, cert: null, part: trip.purpose === 'owner' ? 91 : 135 },
    client: { name: trip.contact?.name || null, company: trip.company_name || null, address: null },
    aircraft: { tail, type, serial: null, maxPax, year: null },
    totals: { legs: legs.length, distance: totalDist || null, minutes: totalMin || null },
    tsa: null,
    legs,
    manifest: tripManifest,
    maintenance: null,
    preparedOn: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  };
}
```

- [ ] **Step 4: Run it — PASS** (3 tests). Then `cd backend && node --test src/services/*.test.js` → 0 fail. Import smoke: `node --input-type=module -e "import('./src/services/nativeTripSheetData.js').then(()=>console.log('IMPORT_OK')).catch(e=>{console.error(e.message);process.exit(1)})"` → IMPORT_OK.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/nativeTripSheetData.js backend/src/services/nativeTripSheetData.test.js
git commit -m "feat(tripsheet): native trip-sheet view-model builder"
```

---

## Task 2: Branch the trip-sheet route

**Files:** Modify `backend/src/routes/tripSheet.js`

- [ ] **Step 1: Add the dispatcher** after the existing imports:
```js
import { buildNativeTripSheetVM } from '../services/nativeTripSheetData.js';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const buildTSVM = (id) => (UUID_RE.test(id) ? buildNativeTripSheetVM(id) : buildCrewTripSheet(id));
```

- [ ] **Step 2: Use `buildTSVM`** in both handlers — replace `buildCrewTripSheet(req.params.id)` with `buildTSVM(req.params.id)` in `GET /:id` and `GET /:id/pdf`. (The existing `if (!vm) return 404` guards stay — a native trip with no legs returns null → 404, which is fine.)

- [ ] **Step 3: Import smoke** — `cd backend && node --input-type=module -e "import('./src/routes/tripSheet.js').then(()=>console.log('IMPORT_OK')).catch(e=>{console.error(e.message);process.exit(1)})"` → IMPORT_OK. Suite: `node --test src/services/*.test.js` → 0 fail.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/tripSheet.js
git commit -m "feat(tripsheet): trip-sheet route renders native trips"
```

---

## Task 3: Verification

- [ ] **Step 1: Tests + smokes** — `cd backend && node --test src/scheduling/*.test.js src/services/*.test.js` (0 fail); `nativeTripSheetData.js` + `routes/tripSheet.js` import smokes print IMPORT_OK.

- [ ] **Step 2: Manual checklist** (user, on a released native trip with crew + manifest):
  - The trip detail's **View Crew Trip Sheet ↗** (`/scheduling/trips/:id/sheet` → `/api/tripsheet/:uuid`) renders the branded Midnight trip sheet: route, **operator = EXJET AVIATION** (+ address; no cert line), **Part 135** for charter / **91** for owner, **crew names**, **FBOs**, the **full pax manifest** (DOB/weight/citizenship/passport from the people directory), times + totals.
  - The maintenance, METAR, per-leg comms/elevation/timezone, and fuel sections are **absent/blank** (by design).

---

## D2 — Definition of Done

- `node --test src/services/nativeTripSheetData.test.js` passes (3); full backend suites green.
- A native trip's `/api/tripsheet/:uuid` (+ `/pdf`) renders the trip sheet with native crew/FBO/manifest, Exjet operator, Purpose-derived Part, and the LF-only sections cleanly omitted.

## After D2 — native documents complete
With D1 + D2, all three documents (quote, itinerary, trip sheet) render from native trips. The remaining future work is the **LevelFlight cutover** (real numbering, retiring LF) — and, if ever wanted, enriching the omitted trip-sheet sections (live METAR, a maintenance feed, richer airport data, crew DOB/phone, aircraft serial/year).
