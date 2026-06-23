# Quoting → Dispatch Revamp — Phase D1 (Native Itinerary) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the passenger **itinerary** document render from a NATIVE trip (uuid), reusing the existing tested `mapItineraryLeg` mapper + the Midnight renderer unchanged — mirroring the Phase-B native-quote pattern.

**Architecture:** A new `nativeItineraryData.js` builds the itinerary VM from `scheduling_trips` + `scheduling_legs` + `scheduling_passengers`/`scheduling_people`. It **enriches each native leg snapshot into the LF leg shape** (`_calc` from `airportName`/`airportCoord`/`legMinutes`; `passengers[]` from the manifest) and then **reuses the exported `mapItineraryLeg`** — so crew (already in the snapshot via the Crew tab), FBO (already in the snapshot via C3), and lead-passenger logic all come for free. The doc routes branch **uuid → native** (same `UUID_RE` pattern as `publicQuotes.js`). Renderers (`itineraryHtml.js`) are untouched — they already guard nulls.

**Tech Stack:** Node + Express, `node:test`, Supabase. Backend test from `backend/`: `node --test src/services/*.test.js`. Import smokes for the routes.

**Phase context:** D1 of Phase D (native documents, deferred from Phase B). Native trips now carry crew (Crew tab → `lf_synced_snapshot.pilots/attendants`) and FBO (C3 → `lf_synced_snapshot.departure.fbo`/`arrival.fbo`). The trip-sheet (D2) is a separate plan (it has maintenance/METAR/elevation gaps). No migration.

**Reference (the pattern to mirror):** `backend/src/services/nativeQuoteData.js` (`buildNativeQuoteVM` + `mapNativeQuoteLeg`) + the uuid→native branch in `backend/src/routes/publicQuotes.js`.

---

## File Structure

**Create:**
- `backend/src/services/nativeItineraryData.js` — `toLfLeg` (pure) + `buildNativeItineraryVM(tripId)`.
- `backend/src/services/nativeItineraryData.test.js` — tests `mapItineraryLeg(toLfLeg(...))`.

**Modify:**
- `backend/src/routes/publicItinerary.js` — branch `/itinerary/:id` + `/pdf` uuid→native.
- `backend/src/routes/scheduling.js` — branch the two itinerary routes (`/trips/:lfOid/itinerary/email-preview` + `/send`) uuid→native.

---

## Task 1: Native itinerary VM builder

**Files:** Create `backend/src/services/nativeItineraryData.js` + `.test.js`.

Key facts (verified): `itineraryData.js` exports `mapItineraryLeg(l)` which reads `l.departure/arrival.{airport,time,fbo}`, `l._calc.{from,to}.{name,location}`, `l._calc.distance.value`, `l._calc.time`, `l.passengers` (lead via `leadUserId`), `l.pilots/attendants`. `airportName(icao)` (`scheduling/airportNames.js`), `airportCoord(icao)`→`{lat,lng}` (`scheduling/airports.js`), `aircraftInfo(tail)`→`{type,maxPax}` (`scheduling/fleet.js`), `legMinutes(aircraftType, legs)`→`[{minutes,distanceNm}]` (`scheduling/priceQuote.js`), `getDailyForecast(lat,lng)` (`services/weather.js`). The native leg snapshot (`lf_synced_snapshot`) has `departure/arrival.{time,fbo}`, `pilots:[{seat,user}]`, `attendants:[{user}]`, `passengerCount`, `isPositioning`, `dispatch.aircraft.tailNumber`.

- [ ] **Step 1: Write the failing test** (`nativeItineraryData.test.js`) — exercises the pure `toLfLeg` through the real `mapItineraryLeg`, using bundled airport data:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toLfLeg } from './nativeItineraryData.js';
import { mapItineraryLeg } from './itineraryData.js';

const snap = {
  passengerCount: 2, isPositioning: false,
  departure: { time: Date.parse('2026-07-01T12:00:00Z'), fbo: { name: 'BANYAN AIR SERVICE', address: { street: '5360 NW 20TH TERRACE', city: 'FORT LAUDERDALE' }, phones: ['800-200-2031'] } },
  arrival: { time: Date.parse('2026-07-01T14:13:00Z'), fbo: null },
  pilots: [{ seat: 2, user: { _id: 'p1', firstName: 'Mike', lastName: 'Reyes' } }, { seat: 3, user: { _id: 'p2', firstName: 'Dave', lastName: 'Cohen' } }],
  attendants: [{ user: { _id: 'a1', firstName: 'Lauren', lastName: 'Pierce' } }],
};
const legRow = { dep_icao: 'KFXE', arr_icao: 'KTEB', dep_time: '2026-07-01T12:00:00Z', arr_time: '2026-07-01T14:13:00Z', lf_synced_snapshot: snap };
const paxLf = [
  { seat: 1, user: { _id: 'x1', firstName: 'John', lastName: 'Carter' } },
  { seat: 2, user: { _id: 'x2', firstName: 'Emily', lastName: 'Carter' } },
];

test('toLfLeg → mapItineraryLeg yields the itinerary leg shape', () => {
  const m = mapItineraryLeg(toLfLeg(legRow, { minutes: 133, distanceNm: 932 }, paxLf));
  assert.equal(m.from, 'KFXE');
  assert.equal(m.to, 'KTEB');
  assert.equal(m.fromName, 'Fort Lauderdale Executive Airport');
  assert.equal(m.toName, 'Teterboro Airport');
  assert.equal(m.distance, 932);
  assert.equal(m.eft, '2:13');
  assert.equal(m.pax, 2);
  assert.equal(m.passengers[0].name, 'John Carter'); // lead = unique min seat (1)
  assert.equal(m.passengers[0].lead, true);
  assert.equal(m.crew.pic, 'Mike Reyes');
  assert.equal(m.crew.sic, 'Dave Cohen');
  assert.deepEqual(m.crew.ca, ['Lauren Pierce']);
  assert.equal(m.depFbo.name, 'BANYAN AIR SERVICE');
  assert.ok(Array.isArray(m.fromLatLng) && m.fromLatLng[0] > 0 && m.fromLatLng[1] < 0);
});

test('toLfLeg: positioning/empty leg carries no passengers', () => {
  const ferry = { ...legRow, lf_synced_snapshot: { ...snap, passengerCount: 0, isPositioning: true } };
  const m = mapItineraryLeg(toLfLeg(ferry, { minutes: 100, distanceNm: 400 }, paxLf));
  assert.equal(m.pax, 0);
  assert.deepEqual(m.passengers, []);
});
```

- [ ] **Step 2: Run it — FAIL** (`Cannot find module './nativeItineraryData.js'`).
Run: `cd backend && node --test src/services/nativeItineraryData.test.js`

- [ ] **Step 3: Implement** `nativeItineraryData.js`:

```js
import { supabase } from './supabase.js';
import { getDailyForecast } from './weather.js';
import { mapItineraryLeg } from './itineraryData.js';
import { airportName } from '../scheduling/airportNames.js';
import { airportCoord } from '../scheduling/airports.js';
import { aircraftInfo } from '../scheduling/fleet.js';
import { legMinutes } from '../scheduling/priceQuote.js';

const eftStr = (mins) => { const m = Math.round(mins || 0); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

// Pure: enrich a native leg row (+ computed time + the trip manifest in LF passenger
// shape) into the LevelFlight leg shape that mapItineraryLeg consumes. Crew + FBO come
// from the stored snapshot (Crew tab / C3); _calc + passengers are synthesized.
export const toLfLeg = (legRow, time, paxLf) => {
  const snap = legRow.lf_synced_snapshot || {};
  const depC = airportCoord(legRow.dep_icao), arrC = airportCoord(legRow.arr_icao);
  const hasPax = (snap.passengerCount || 0) > 0 && !snap.isPositioning;
  return {
    departure: { airport: legRow.dep_icao || null, time: snap.departure?.time ?? (legRow.dep_time ? Date.parse(legRow.dep_time) : null), fbo: snap.departure?.fbo || null },
    arrival: { airport: legRow.arr_icao || null, time: snap.arrival?.time ?? (legRow.arr_time ? Date.parse(legRow.arr_time) : null), fbo: snap.arrival?.fbo || null },
    _calc: {
      from: { name: airportName(legRow.dep_icao), location: depC ? { lat: depC.lat, lng: depC.lng } : null },
      to: { name: airportName(legRow.arr_icao), location: arrC ? { lat: arrC.lat, lng: arrC.lng } : null },
      distance: { value: time?.distanceNm ?? null },
      time: time ? eftStr(time.minutes) : null,
    },
    passengers: hasPax ? paxLf : [],
    passengerCount: hasPax ? paxLf.length : 0,
    pilots: snap.pilots || [],
    attendants: snap.attendants || [],
  };
};

// Build the passenger-itinerary VM for a NATIVE trip (uuid). Same shape as
// itineraryData.buildItinerary, so renderItineraryHtml renders identically.
export async function buildNativeItineraryVM(tripId) {
  const { data: trip, error } = await supabase
    .from('scheduling_trips').select('id, quote_number, trip_number, company_name, contact').eq('id', tripId).single();
  if (error || !trip) return null;
  const { data: legRows } = await supabase
    .from('scheduling_legs').select('dep_icao, arr_icao, dep_time, arr_time, lf_synced_snapshot, seq').eq('trip_id', tripId).order('seq');
  const rows = legRows || [];
  const { data: paxRows } = await supabase
    .from('scheduling_passengers').select('seat, person_id, person:scheduling_people(first_name, last_name)').eq('trip_id', tripId);
  const paxLf = (paxRows || []).map((p) => ({
    seat: (p.seat != null && p.seat !== '' && !Number.isNaN(Number(p.seat))) ? Number(p.seat) : null,
    user: { _id: p.person_id, firstName: p.person?.first_name, lastName: p.person?.last_name },
  }));

  const tail = rows[0]?.lf_synced_snapshot?.dispatch?.aircraft?.tailNumber || null;
  const { type, maxPax } = aircraftInfo(tail);
  const times = await legMinutes(null, rows.map((l) => ({ dep_icao: l.dep_icao, arr_icao: l.arr_icao })));
  const allLegs = rows.map((l, i) => mapItineraryLeg(toLfLeg(l, times[i], paxLf)));
  const withPax = allLegs.filter((l) => (l.pax || 0) > 0);
  const legs = withPax.length ? withPax : allLegs;

  const airports = new Map();
  for (const l of legs) {
    if (l.from && l.fromLatLng) airports.set(l.from, { code: l.from, name: l.fromName, ll: l.fromLatLng });
    if (l.to && l.toLatLng) airports.set(l.to, { code: l.to, name: l.toName, ll: l.toLatLng });
  }
  const weather = [];
  for (const a of airports.values()) {
    const forecast = await getDailyForecast(a.ll[0], a.ll[1]);
    if (forecast.length) weather.push({ code: a.code, name: a.name, forecast });
  }

  return {
    dispatchId: tripId,
    tripNumber: trip.trip_number != null ? String(trip.trip_number) : null,
    quoteNumber: trip.quote_number != null ? String(trip.quote_number) : null,
    tail, aircraftType: type, maxPax,
    client: { name: trip.contact?.name || null, company: trip.company_name || null, address: null },
    legs, weather,
    preparedOn: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
  };
}
```

- [ ] **Step 4: Run it — PASS** (2 tests). Then the services suite: `cd backend && node --test src/services/*.test.js` → 0 fail. Import smoke: `node --input-type=module -e "import('./src/services/nativeItineraryData.js').then(()=>console.log('IMPORT_OK')).catch(e=>{console.error(e.message);process.exit(1)})"` → IMPORT_OK.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/nativeItineraryData.js backend/src/services/nativeItineraryData.test.js
git commit -m "feat(itinerary): native itinerary view-model builder"
```

---

## Task 2: Branch the public itinerary routes

**Files:** Modify `backend/src/routes/publicItinerary.js`

- [ ] **Step 1: Add the dispatcher** after the existing imports:
```js
import { buildNativeItineraryVM } from '../services/nativeItineraryData.js';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const buildItinVM = (id) => (UUID_RE.test(id) ? buildNativeItineraryVM(id) : buildItinerary(id));
```

- [ ] **Step 2: Use `buildItinVM`** in both handlers (`GET /:id` web and `GET /:id/pdf`) — replace `buildItinerary(req.params.id)` with `buildItinVM(req.params.id)`. Add a null guard before rendering (a missing native trip → 404 rather than a crash):
```js
    const vm = await buildItinVM(req.params.id);
    if (!vm) return res.status(404).type('html').send('<p>Itinerary not found.</p>');
```
(for the pdf handler: `if (!vm) return res.status(404).send('Itinerary not found');`)

- [ ] **Step 3: Import smoke** — `cd backend && node --input-type=module -e "import('./src/routes/publicItinerary.js').then(()=>console.log('IMPORT_OK')).catch(e=>{console.error(e.message);process.exit(1)})"` → IMPORT_OK.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/publicItinerary.js
git commit -m "feat(itinerary): public itinerary route renders native trips"
```

---

## Task 3: Branch the itinerary email-preview + send routes

**Files:** Modify `backend/src/routes/scheduling.js`

The `GET /api/scheduling/trips/:lfOid/itinerary/email-preview` and `POST /api/scheduling/trips/:lfOid/itinerary/send` handlers call `buildItinerary(req.params.lfOid)` — which fails for a native uuid (it calls `getTripLog`). Branch them.

- [ ] **Step 1: Add imports** (with the other imports — `buildItinerary` is already imported; add the native one + reuse the file's existing `UUID_RE`/`tripColumn` which already exist):
```js
import { buildNativeItineraryVM } from '../services/nativeItineraryData.js';
```
The file already has `UUID_RE` (used by `tripColumn`). Add a helper near the top (after `tripColumn`):
```js
const buildItinVM = (id) => (UUID_RE.test(id) ? buildNativeItineraryVM(id) : buildItinerary(id));
```

- [ ] **Step 2: Replace both call sites.** In the `email-preview` handler and the `send` handler, replace `buildItinerary(req.params.lfOid)` with `buildItinVM(req.params.lfOid)`. (Leave the rest — `buildItineraryEmail`, `sendEmail`, `renderItineraryHtml`, `renderQuotePdf` — unchanged; they consume the VM.)

- [ ] **Step 3: Import smoke + suite** — `cd backend && node --input-type=module -e "import('./src/routes/scheduling.js').then(()=>console.log('IMPORT_OK')).catch(e=>{console.error(e.message);process.exit(1)})"` → IMPORT_OK; `node --test src/scheduling/*.test.js src/services/*.test.js` → 0 fail.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/scheduling.js
git commit -m "feat(itinerary): itinerary email preview/send support native trips"
```

---

## Task 4: Verification

- [ ] **Step 1: Tests + smokes** — `cd backend && node --test src/scheduling/*.test.js src/services/*.test.js` (0 fail); all three route/module import smokes print IMPORT_OK.

- [ ] **Step 2: Manual checklist** (user, on a native trip with a manifest + crew assigned):
  - The Trip Overview rail's **View Passenger Itinerary ↗** (`/itinerary/<uuid>`) renders the branded Midnight itinerary — route, airport names, ETE, **pax (lead highlighted)**, **crew names**, **FBOs** (where picked), and weather.
  - **Send Itinerary** preview + send works for the native trip.
  - Empty/ferry legs are hidden (no pax).

---

## D1 — Definition of Done

- `node --test src/services/nativeItineraryData.test.js` passes (2); full backend suites green.
- A native trip's `/itinerary/:uuid` (+ `/pdf`) renders the itinerary identically to an LF one, with native crew/FBO/manifest.
- Itinerary email preview/send works for native trips.

## Notes for D2 (trip-sheet — separate plan, needs your decisions)
- The trip-sheet needs operator cert/part, aircraft serial/year, elevation/timezone/comms, METAR, fuel burn, and maintenance — none native. Decisions to confirm before D2: hardcode Exjet operator constants (need the cert # + Part); omit vs. placeholder the maintenance/METAR/comms/elevation sections; whether to live-fetch METAR. Crew names come from the snapshot (no DOB/phone without a roster lookup). Manifest (dob/weight/passport/citizenship) is fully available from `scheduling_people`.
