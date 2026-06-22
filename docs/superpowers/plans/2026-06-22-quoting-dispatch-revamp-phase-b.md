# Quoting → Dispatch Revamp — Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an FBO directory (bulk-imported from LevelFlight) and make the client-facing **Quote** document render + be acceptable for **native** trips (not just LevelFlight dispatches).

**Architecture:** The three document renderers stay unchanged. We add a **native Quote view-model builder** that produces the exact VM shape `renderQuoteHtml` already consumes, enriching a native trip (coords + airport names from bundled datasets, distance/ETE from the existing flight-time engine, type/seats from a small fleet map, total from `pricing`). The public `/quote/:id` route branches **uuid → native** vs **24-hex → LevelFlight**. A new public **accept** link records client acceptance + emails ops. FBOs land in the `airport_fbos` table (created in migration 018) via a pure parser + a rate-limited bulk-import script, served by a lazy-caching route.

**Tech Stack:** Node + Express, Supabase (PostgREST), `node:test`, LevelFlight REST (verified FBO endpoint), Puppeteer (existing PDF path), Gmail (existing `sendEmail`).

**Phase context:** Phase B of the revamp. Phase A (backend foundation) is merged. **Native itinerary + trip-sheet are intentionally NOT in Phase B** — they need crew (Phase C) and data native trips lack (maintenance/METAR/elevation); they come after Phase C. Phase C = the tabbed Trip Overview frontend + FBO pickers + crew assignment.

**Conventions:** Migrations are applied **manually** in Supabase (after writing `019`, ask the user to run it). Stores **soft-fail** if a column/table is absent. Never print `.env`/secrets. Tests run from `backend/`: `node --test src/scheduling/*.test.js src/services/*.test.js`. The native leg ROW has columns `dep_icao/arr_icao/dep_time/arr_time/lf_synced_snapshot`; tail + pax live in `lf_synced_snapshot.dispatch.aircraft.tailNumber` / `.passengerCount`.

---

## File Structure

**Create:**
- `backend/migrations/019_quote_accept.sql` — `scheduling_trips.accepted_at` + `accepted_note`.
- `backend/src/scheduling/fleet.js` (+ `.test.js`) — `aircraftInfo(tail)` → `{type, maxPax}`.
- `backend/src/scheduling/airportNames.js` (+ `.test.js`) — `airportName(icao)` from the bundled `data/airportNames.json`.
- `backend/src/services/fbos.js` (+ `.test.js`) — `fbosFromLfResponse` (pure parser) + `fetchAirportFbos`/`upsertFbos`/`listFbos`.
- `backend/src/services/nativeQuoteData.js` (+ `.test.js`) — `mapNativeQuoteLeg` (pure) + `buildNativeQuoteVM(tripId)`.
- `backend/scripts/importFbos.mjs` — rate-limited, resumable bulk import.

**Modify:**
- `backend/src/services/levelflight.js` — add `getAirportFbos(icao)`.
- `backend/src/routes/publicQuotes.js` — branch uuid→native for `/:id` + `/:id/pdf`; add `GET /:id/accept`.
- `backend/src/routes/scheduling.js` — add `GET /airport/:icao/fbos` (lazy cache).

---

## Task 1: Migration 019 (quote acceptance columns)

**Files:** Create `backend/migrations/019_quote_accept.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 019_quote_accept.sql — native quote "Request to Book" acceptance.
-- Apply manually in the Supabase SQL editor. Idempotent.
ALTER TABLE scheduling_trips ADD COLUMN IF NOT EXISTS accepted_at   timestamptz;
ALTER TABLE scheduling_trips ADD COLUMN IF NOT EXISTS accepted_note text;
```

- [ ] **Step 2: Verify it parses**

Run: `grep -c "ADD COLUMN IF NOT EXISTS" backend/migrations/019_quote_accept.sql`
Expected: `2`

- [ ] **Step 3: Ask the user to apply it** (no DB access here). Note: stores soft-fail until applied.

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/019_quote_accept.sql
git commit -m "feat(db): migration 019 — quote acceptance columns"
```

---

## Task 2: Fleet reference (`aircraftInfo`)

**Files:** Create `backend/src/scheduling/fleet.js` + `backend/src/scheduling/fleet.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aircraftInfo } from './fleet.js';

test('aircraftInfo: known tail returns type + seats', () => {
  assert.deepEqual(aircraftInfo('N69FP'), { type: 'Gulfstream GIV SP', maxPax: 15 });
});
test('aircraftInfo: case/space-insensitive', () => {
  assert.deepEqual(aircraftInfo(' n408js '), { type: 'Gulfstream GIV SP', maxPax: 15 });
});
test('aircraftInfo: unknown tail returns nulls', () => {
  assert.deepEqual(aircraftInfo('N999ZZ'), { type: null, maxPax: null });
});
```

- [ ] **Step 2: Run it — FAIL** (`Cannot find module './fleet.js'`)
Run: `cd backend && node --test src/scheduling/fleet.test.js`

- [ ] **Step 3: Implement**

```js
// Native fleet reference — aircraft type + seat count per tail. LevelFlight carries
// this on aircraft.type.name / aircraft.paxSeats; native quotes don't call LF, so we
// keep a small static map. Extend as the fleet changes.
const FLEET = {
  N408JS: { type: 'Gulfstream GIV SP', maxPax: 15 },
  N69FP:  { type: 'Gulfstream GIV SP', maxPax: 15 },
};

export const aircraftInfo = (tail) => FLEET[(tail || '').trim().toUpperCase()] || { type: null, maxPax: null };
```

- [ ] **Step 4: Run it — PASS** (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/scheduling/fleet.js backend/src/scheduling/fleet.test.js
git commit -m "feat(scheduling): native fleet reference (type + seats per tail)"
```

---

## Task 3: Airport name lookup (`airportName`)

**Files:** Create `backend/src/scheduling/airportNames.js` + `backend/src/scheduling/airportNames.test.js`
The dataset `backend/src/scheduling/data/airportNames.json` already exists: `{ "KFXE": { "n": "...", "c": "...", "r": "..." }, … }`.

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airportName } from './airportNames.js';

test('airportName: known ICAO returns the full name', () => {
  assert.equal(airportName('KFXE'), 'Fort Lauderdale Executive Airport');
});
test('airportName: case/space-insensitive', () => {
  assert.equal(airportName(' kteb '), 'Teterboro Airport');
});
test('airportName: unknown ICAO returns null', () => {
  assert.equal(airportName('ZZZZ'), null);
});
```

- [ ] **Step 2: Run it — FAIL**
Run: `cd backend && node --test src/scheduling/airportNames.test.js`

- [ ] **Step 3: Implement**

```js
import { readFileSync } from 'fs';

// Friendly airport names (ICAO → { n: name, c: city, r: region }). Bundled dataset.
const NAMES = JSON.parse(readFileSync(new URL('./data/airportNames.json', import.meta.url)));

// Full airport name for an ICAO, or null if unknown.
export const airportName = (icao) => {
  const rec = NAMES[(icao || '').trim().toUpperCase()];
  return rec?.n || null;
};
```

- [ ] **Step 4: Run it — PASS** (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/scheduling/airportNames.js backend/src/scheduling/airportNames.test.js
git commit -m "feat(scheduling): airport name lookup from bundled dataset"
```

---

## Task 4: FBO service (`fbos.js`) + LevelFlight call

**Files:** Create `backend/src/services/fbos.js` + `backend/src/services/fbos.test.js`; modify `backend/src/services/levelflight.js`.

- [ ] **Step 1: Write the failing test** (the pure parser only)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fbosFromLfResponse } from './fbos.js';

const lf = {
  success: true,
  fbos: {
    '1039': {
      id: '1039', name: 'BANYAN AIR SERVICE',
      address: { street: '5360 NW 20TH TERRACE', city: 'FORT LAUDERDALE', state: 'FLORIDA', postalCode: '33309', country: 'UNITED STATES' },
      loc: { type: 'Point', coordinates: [-80.1725, 25.2019] },
      phones: ['800-200-2031', '954-491-3170'], fax: '954-771-0281',
      email: 'frontdesk@banyanair.com', website: 'www.banyanair.com',
      comms: { arinc: '129.85' }, hours: '06:00 - 22:00',
    },
  },
};

test('fbosFromLfResponse: maps fbos to rows (coordinates are [lng,lat])', () => {
  const rows = fbosFromLfResponse(lf, 'kfxe');
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.fbo_id, '1039');
  assert.equal(r.icao, 'KFXE');
  assert.equal(r.name, 'BANYAN AIR SERVICE');
  assert.equal(r.lng, -80.1725);
  assert.equal(r.lat, 25.2019);
  assert.deepEqual(r.phones, ['800-200-2031', '954-491-3170']);
  assert.equal(r.email, 'frontdesk@banyanair.com');
  assert.equal(r.raw.id, '1039');
});

test('fbosFromLfResponse: missing/empty fbos → []', () => {
  assert.deepEqual(fbosFromLfResponse({ success: true }, 'KFXE'), []);
  assert.deepEqual(fbosFromLfResponse(null, 'KFXE'), []);
});
```

- [ ] **Step 2: Run it — FAIL**
Run: `cd backend && node --test src/services/fbos.test.js`

- [ ] **Step 3: Add the LevelFlight call** in `backend/src/services/levelflight.js` (next to the other exports — the base URL is `rest.levelflight.com`, same host as the verified probe):

```js
// FBOs for an airport: GET /api/airport/fbo/{ICAO} → { success, message, fbos: { "<id>": {...} } }
export const getAirportFbos = async (icao) =>
  (await (await lf()).get(`/api/airport/fbo/${encodeURIComponent(icao)}`)).data;
```

- [ ] **Step 4: Implement `backend/src/services/fbos.js`**

```js
import { supabase } from './supabase.js';
import { getAirportFbos } from './levelflight.js';

// Pure: parse LevelFlight's FBO response into airport_fbos rows. LF `loc.coordinates`
// is GeoJSON [lng, lat].
export const fbosFromLfResponse = (json, icao) => {
  const fbos = json?.fbos;
  if (!fbos || typeof fbos !== 'object') return [];
  const ic = (icao || '').trim().toUpperCase();
  return Object.values(fbos).map((f) => ({
    fbo_id: String(f.id),
    icao: ic,
    name: f.name || null,
    address: f.address || null,
    lng: Array.isArray(f.loc?.coordinates) ? (f.loc.coordinates[0] ?? null) : null,
    lat: Array.isArray(f.loc?.coordinates) ? (f.loc.coordinates[1] ?? null) : null,
    phones: Array.isArray(f.phones) ? f.phones : null,
    fax: f.fax || null,
    email: f.email || null,
    website: f.website || null,
    comms: f.comms || null,
    hours: f.hours || null,
    raw: f,
  }));
};

// Fetch + parse FBOs for an airport from LevelFlight.
export const fetchAirportFbos = async (icao) => fbosFromLfResponse(await getAirportFbos(icao), icao);

// Upsert FBO rows (idempotent on fbo_id).
export const upsertFbos = async (rows) => {
  if (!rows?.length) return { count: 0 };
  const { error } = await supabase.from('airport_fbos').upsert(rows, { onConflict: 'fbo_id' });
  if (error) throw error;
  return { count: rows.length };
};

// FBOs for an airport from our DB.
export const listFbos = async (icao) => {
  const { data, error } = await supabase.from('airport_fbos').select('*').eq('icao', (icao || '').trim().toUpperCase());
  if (error) return [];
  return data || [];
};
```

- [ ] **Step 5: Run it — PASS** (2 tests)

- [ ] **Step 6: Real-data smoke test** (you CAN run this from `backend/` — it hits LF with our creds; prints structure only, no secrets):

```bash
cd /Users/santiagotorres/Developer/exjet-dashboard/backend && node --input-type=module -e "
import { fetchAirportFbos } from './src/services/fbos.js';
const r = await fetchAirportFbos('KFXE');
console.log('rows:', r.length, '| first:', r[0]?.name, r[0]?.lat, r[0]?.lng);
"
```
Expected: `rows: 1 | first: BANYAN AIR SERVICE 25.20… -80.17…` (proves the LF call + parser + coord order). If it errors with a 404/empty, the LF base URL differs from `rest.levelflight.com` — report as a concern (the call may need the absolute URL).

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/fbos.js backend/src/services/fbos.test.js backend/src/services/levelflight.js
git commit -m "feat(fbos): LevelFlight FBO fetch + parser + store helpers"
```

---

## Task 5: FBO route (lazy cache)

**Files:** Modify `backend/src/routes/scheduling.js`

- [ ] **Step 1: Add the import** near the other imports:

```js
import { fetchAirportFbos, listFbos, upsertFbos } from '../services/fbos.js';
```

- [ ] **Step 2: Add the route** near the other read routes (e.g. after `GET /leg-estimate`):

```js
// GET /api/scheduling/airport/:icao/fbos — FBOs from our directory; lazily fetch +
// cache from LevelFlight on the first request for an airport we haven't imported.
router.get('/airport/:icao/fbos', async (req, res) => {
  try {
    const icao = (req.params.icao || '').trim().toUpperCase();
    let fbos = await listFbos(icao);
    if (!fbos.length) {
      const rows = await fetchAirportFbos(icao).catch(() => []);
      if (rows.length) { await upsertFbos(rows).catch(() => {}); fbos = rows; }
    }
    res.json({ icao, fbos });
  } catch (e) {
    console.error('GET /api/scheduling/airport/:icao/fbos:', e.message);
    res.status(500).json({ error: 'Failed to load FBOs' });
  }
});
```

- [ ] **Step 3: Smoke-test the route module imports**
Run: `cd backend && node --input-type=module -e "import('./src/routes/scheduling.js').then(()=>console.log('IMPORT_OK')).catch(e=>{console.error(e.message);process.exit(1)})"`
Expected: `IMPORT_OK`

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/scheduling.js
git commit -m "feat(scheduling): GET /airport/:icao/fbos with lazy LF cache"
```

---

## Task 6: FBO bulk-import script

**Files:** Create `backend/scripts/importFbos.mjs`

- [ ] **Step 1: Write the script**

```js
// One-time / re-runnable FBO backfill. Iterates US-prefix airports (≈4,900) plus any
// ICAO we already fly, fetches FBOs from LevelFlight, upserts into airport_fbos.
// Rate-limited + resumable (skips airports synced in the last RESYNC_DAYS) + logs
// zero-FBO airports. Run from backend/: `node scripts/importFbos.mjs`
import 'dotenv/config';
import { readFileSync } from 'fs';
import { supabase } from '../src/services/supabase.js';
import { fetchAirportFbos, upsertFbos } from '../src/services/fbos.js';

const RESYNC_DAYS = 30;
const DELAY_MS = 200; // be polite to LF
const US_PREFIX = /^(K|PA|PH|PG|PJ|TI|TJ)/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const names = JSON.parse(readFileSync(new URL('../src/scheduling/data/airportNames.json', import.meta.url)));
const usIcaos = Object.keys(names).filter((k) => US_PREFIX.test(k));

// Plus airports we actually fly (any region).
const { data: legRows } = await supabase.from('scheduling_legs').select('dep_icao, arr_icao');
const flown = new Set();
for (const l of legRows || []) { if (l.dep_icao) flown.add(l.dep_icao); if (l.arr_icao) flown.add(l.arr_icao); }
const targets = [...new Set([...usIcaos, ...flown])].filter(Boolean);

// Resume: skip airports already synced recently.
const since = new Date(Date.now() - RESYNC_DAYS * 86400000).toISOString();
const { data: recent } = await supabase.from('airport_fbos').select('icao, synced_at').gte('synced_at', since);
const done = new Set((recent || []).map((r) => r.icao));

let withFbos = 0, zero = 0, failed = 0;
console.log(`Targets: ${targets.length} (skipping ${done.size} synced in last ${RESYNC_DAYS}d)`);
for (let i = 0; i < targets.length; i++) {
  const icao = targets[i];
  if (done.has(icao)) continue;
  try {
    const rows = await fetchAirportFbos(icao);
    if (rows.length) { await upsertFbos(rows); withFbos++; }
    else { zero++; }
  } catch (e) { failed++; console.warn(`  ${icao}: ${e.message}`); }
  if (i % 100 === 0) console.log(`  …${i}/${targets.length} (fbos:${withFbos} zero:${zero} fail:${failed})`);
  await sleep(DELAY_MS);
}
console.log(`Done. airports with FBOs: ${withFbos}, zero-FBO: ${zero}, failed: ${failed}`);
```

- [ ] **Step 2: Verify it parses** (do NOT run the full import here — it's ~4,900 LF calls; the user runs it once after migration 018 is applied, which it is)
Run: `cd backend && node --check scripts/importFbos.mjs && echo "SYNTAX_OK"`
Expected: `SYNTAX_OK`

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/importFbos.mjs
git commit -m "feat(fbos): rate-limited resumable bulk import script"
```

> Note for the controller/user: the actual bulk run (`node scripts/importFbos.mjs` from `backend/`) is a one-time operation the user kicks off; it's resumable, so interrupting/re-running is safe.

---

## Task 7: Native Quote view-model (`nativeQuoteData.js`)

**Files:** Create `backend/src/services/nativeQuoteData.js` + `backend/src/services/nativeQuoteData.test.js`

- [ ] **Step 1: Write the failing test** (the pure leg mapper — uses the bundled airport data, no mocks)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapNativeQuoteLeg } from './nativeQuoteData.js';

test('mapNativeQuoteLeg: builds the quote VM leg shape', () => {
  const leg = { dep_icao: 'KFXE', arr_icao: 'KTEB', dep_time: '2026-07-01T12:00:00Z', arr_time: '2026-07-01T14:13:00Z', pax: 4 };
  const m = mapNativeQuoteLeg(leg, { minutes: 133, distanceNm: 932 });
  assert.equal(m.from, 'KFXE');
  assert.equal(m.to, 'KTEB');
  assert.equal(m.fromName, 'Fort Lauderdale Executive Airport');
  assert.equal(m.toName, 'Teterboro Airport');
  assert.equal(m.distance, 932);
  assert.equal(m.eft, '2:13');
  assert.equal(m.pax, 4);
  assert.equal(m.depTime, Date.parse('2026-07-01T12:00:00Z'));
  assert.ok(Array.isArray(m.fromLatLng) && m.fromLatLng.length === 2);
  assert.ok(Array.isArray(m.toLatLng) && m.toLatLng.length === 2);
});

test('mapNativeQuoteLeg: unknown airport → null name/coords, still maps codes', () => {
  const m = mapNativeQuoteLeg({ dep_icao: 'ZZZZ', arr_icao: 'KTEB', dep_time: null, arr_time: null, pax: 0 }, null);
  assert.equal(m.from, 'ZZZZ');
  assert.equal(m.fromName, null);
  assert.equal(m.fromLatLng, null);
  assert.equal(m.distance, null);
  assert.equal(m.eft, null);
});
```

- [ ] **Step 2: Run it — FAIL**
Run: `cd backend && node --test src/services/nativeQuoteData.test.js`

- [ ] **Step 3: Implement**

```js
import { supabase } from './supabase.js';
import { airportCoord } from '../scheduling/airports.js';
import { airportName } from '../scheduling/airportNames.js';
import { aircraftInfo } from '../scheduling/fleet.js';
import { legMinutes } from '../scheduling/priceQuote.js';

const eftStr = (mins) => { const m = Math.round(mins || 0); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

// Pure: one native leg (+ its computed time) → the quote VM leg shape that
// renderQuoteHtml consumes. Coords come back as [lat, lng] like the LF VM.
export const mapNativeQuoteLeg = (leg, time) => {
  const dep = airportCoord(leg.dep_icao), arr = airportCoord(leg.arr_icao);
  return {
    from: leg.dep_icao || null,
    to: leg.arr_icao || null,
    fromName: airportName(leg.dep_icao),
    toName: airportName(leg.arr_icao),
    depTime: leg.dep_time ? Date.parse(leg.dep_time) : null,
    arrTime: leg.arr_time ? Date.parse(leg.arr_time) : null,
    distance: time?.distanceNm ?? null,
    eft: time ? eftStr(time.minutes) : null,
    pax: leg.pax ?? null,
    fromLatLng: dep ? [dep.lat, dep.lng] : null,
    toLatLng: arr ? [arr.lat, arr.lng] : null,
  };
};

const today = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// Build the Quote VM for a NATIVE trip (uuid). Mirrors quoteData.buildViewModel's
// shape so renderQuoteHtml renders identically; acceptUrl/pdfUrl point at our own
// public routes.
export async function buildNativeQuoteVM(tripId) {
  const { data: trip, error } = await supabase
    .from('scheduling_trips').select('id, quote_number, pricing').eq('id', tripId).single();
  if (error || !trip) return null;
  const { data: legRows } = await supabase
    .from('scheduling_legs').select('dep_icao, arr_icao, dep_time, arr_time, lf_synced_snapshot, seq')
    .eq('trip_id', tripId).order('seq');
  const rows = legRows || [];
  const tail = rows[0]?.lf_synced_snapshot?.dispatch?.aircraft?.tailNumber || null;
  const { type, maxPax } = aircraftInfo(tail);
  const times = await legMinutes(null, rows.map((l) => ({ dep_icao: l.dep_icao, arr_icao: l.arr_icao })));
  const legs = rows.map((l, i) => mapNativeQuoteLeg(
    { ...l, pax: l.lf_synced_snapshot?.passengerCount ?? null }, times[i]));
  const total = trip.pricing && !trip.pricing.error ? (trip.pricing.total ?? null) : null;
  return {
    dispatchId: tripId,
    quoteNumber: trip.quote_number != null ? String(trip.quote_number) : null,
    tail, aircraftType: type, maxPax, total,
    amenities: ['Flight Attendant', 'WIFI'],
    preparedBy: null,
    preparedOn: today(),
    acceptUrl: `/quote/${tripId}/accept`,
    pdfUrl: `/quote/${tripId}/pdf`,
    legs,
  };
}
```

- [ ] **Step 4: Run it — PASS** (2 tests)

- [ ] **Step 5: Import smoke test**
Run: `cd backend && node --input-type=module -e "import('./src/services/nativeQuoteData.js').then(()=>console.log('IMPORT_OK')).catch(e=>{console.error(e.message);process.exit(1)})"`
Expected: `IMPORT_OK`

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/nativeQuoteData.js backend/src/services/nativeQuoteData.test.js
git commit -m "feat(quote): native quote view-model builder"
```

---

## Task 8: Public quote route — native branch + accept link

**Files:** Modify `backend/src/routes/publicQuotes.js`

- [ ] **Step 1: Add imports + a VM dispatcher** at the top (after the existing imports):

```js
import { supabase } from '../services/supabase.js';
import { sendEmail } from '../services/gmail.js';
import { buildNativeQuoteVM } from '../services/nativeQuoteData.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// uuid → native trip; 24-hex → LevelFlight dispatch.
const buildQuoteVM = (id) => (UUID_RE.test(id) ? buildNativeQuoteVM(id) : buildViewModel(id));
```

- [ ] **Step 2: Use `buildQuoteVM` in the two existing handlers.** Replace `buildViewModel(req.params.id)` with `buildQuoteVM(req.params.id)` in BOTH the `GET /:id` (web) and `GET /:id/pdf` handlers. Add a null guard so a missing native trip 404s instead of throwing:

```js
// in GET /:id (web):
    const vm = await buildQuoteVM(req.params.id);
    if (!vm) return res.status(404).type('html').send('<p>Quote not found.</p>');
    res.type('html').send(renderQuoteHtml(vm, { print: false, web: true }));

// in GET /:id/pdf:
    const vm = await buildQuoteVM(req.params.id);
    if (!vm) return res.status(404).send('Quote not found');
    const pdf = await renderQuotePdf(renderQuoteHtml(vm, { print: true }));
    res.type('application/pdf').send(pdf);
```

- [ ] **Step 3: Add the native accept route** (the "REQUEST TO BOOK" CTA target). It records acceptance once (idempotent), emails ops, and shows the client a confirmation page. Native trips only:

```js
// GET /quote/:id/accept — client clicks "Request to Book". Records acceptance +
// notifies ops; the dispatcher still books it in the app. Native (uuid) only.
router.get('/:id/accept', async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) return res.status(400).type('html').send('<p>Invalid quote link.</p>');
  try {
    const { data: trip } = await supabase
      .from('scheduling_trips').select('id, quote_number, accepted_at').eq('id', id).single();
    if (!trip) return res.status(404).type('html').send('<p>Quote not found.</p>');
    if (!trip.accepted_at) {
      const note = (req.query.name || '').toString().slice(0, 200) || null;
      await supabase.from('scheduling_trips')
        .update({ accepted_at: new Date().toISOString(), accepted_note: note }).eq('id', id);
      sendEmail({
        to: 'info@flyexjet.vip',
        subject: `Quote ${trip.quote_number || ''} accepted by client`,
        html: `<p>Quote <b>${trip.quote_number || id}</b> was accepted via the client link${note ? ` by ${note}` : ''}.</p><p>Open it in the dashboard to Book.</p>`,
      }).catch((e) => console.warn('[accept email]', e?.message));
    }
    res.type('html').send(`<!doctype html><meta charset="utf-8"><body style="font-family:-apple-system,sans-serif;background:#0b1018;color:#e8edf4;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center"><div><h2>Thank you${' '}— your request to book is received.</h2><p style="color:#8a98ad">Exjet Aviation will confirm your trip shortly.</p></div></body>`);
  } catch (e) {
    console.error('GET /quote/:id/accept:', e.message);
    res.status(500).type('html').send('<p>Something went wrong. Please contact Exjet Aviation.</p>');
  }
});
```

- [ ] **Step 4: Smoke-test the module imports**
Run: `cd backend && node --input-type=module -e "import('./src/routes/publicQuotes.js').then(()=>console.log('IMPORT_OK')).catch(e=>{console.error(e.message);process.exit(1)})"`
Expected: `IMPORT_OK`

- [ ] **Step 5: Full backend test suite** (nothing regressed)
Run: `cd backend && node --test src/scheduling/*.test.js src/services/*.test.js 2>&1 | grep -E "^. (tests|pass|fail)"`
Expected: 0 fail.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/publicQuotes.js
git commit -m "feat(quote): public quote route renders native quotes + accept link"
```

---

## Phase B — Definition of Done

- Migration `019` written + applied by the user.
- `node --test src/scheduling/*.test.js src/services/*.test.js` (from `backend/`) passes (fleet, airportNames, fbos parser, native quote leg mapper).
- FBO real-data smoke (Task 4 Step 6) returns Banyan Air Service for KFXE.
- All route modules import cleanly (`IMPORT_OK`).
- A native trip's `/quote/:uuid` renders the branded quote (manual: open a native quote's public link); "Request to Book" hits the accept route, emails ops, shows the confirmation page.
- User kicks off the one-time `node scripts/importFbos.mjs` backfill.

## Notes for Phase C (frontend)

- The native quote is reachable at `/quote/:uuid` and `/quote/:uuid/pdf` — wire the Documents tab's **View/Send Quote** to these (the existing itinerary send-modal pattern applies).
- FBO pickers (Legs tab) call `GET /api/scheduling/airport/:icao/fbos` and must write the chosen FBO into the leg snapshot's `departure.fbo`/`arrival.fbo` in the shape the doc VMs expect: `{ name, address:{street,city,state,postalCode}, phones:[], comms:{arinc,atg}, crewNote }` (see itinerary/tripSheet `mapFbo`). That snapshot FBO is what the **post-Phase-C** native itinerary/trip-sheet will render.
- The native quote VM intentionally omits crew/FBO/weather — those arrive with Phase C + the later itinerary/trip-sheet phase.
