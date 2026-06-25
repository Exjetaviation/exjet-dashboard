# Quote Editor / Quote↔Trip Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give scheduling quotes their own streamlined editor page (URL keyed by Quote #) with inline leg add/delete, working per-leg flight time, editable client info, a compact auto-priced panel, and autosave — while the existing booked-Trip page (keyed by Trip #) stays intact, both backed by the same `scheduling_trips` row.

**Architecture:** One `scheduling_trips` row carries both `quote_number` and `trip_number`. A new `QuoteEditor` page (evolved from `SchedulingNewTrip.jsx`, reusing its working `useLegEstimate`/`LegRow`) loads a quote by `quote_number`, edits in place with debounced autosave, and books it. The booked trip stays on `SchedulingTripDetail.jsx`, now reachable by `trip_number` (resolving to the row's uuid internally so all downstream uuid-forking calls — tripsheet/quote/itinerary — keep working). Backend changes are additive: number resolution for reads, client-info+purpose persistence on `/details`, and reprice-preserving-manual-edits.

**Tech Stack:** Node ≥20 ESM + Express + Supabase (backend), React 19 + Vite + React Router 7 (frontend), `node:test` (tests). No new dependencies, **no migration** (`quote_number`, `trip_number`, `company_name`, `contact`, `purpose`, `pricing` columns already exist).

**Spec:** `docs/superpowers/specs/2026-06-25-quote-editor-trip-split-design.md`

---

## File Structure

**Backend:**
- Create: `backend/src/scheduling/tripParam.js` — pure helper mapping a trip route param (uuid / 24-hex lf_oid / trip_number) to a Supabase column. Unit-tested.
- Create: `backend/src/scheduling/tripParam.test.js`
- Modify: `backend/src/scheduling/pricing.js` — add `repriceFromBase(fresh, old)` (preserve manual fees/FET/override on a rate-card reprice).
- Modify: `backend/src/scheduling/pricing.test.js` — tests for `repriceFromBase` (create if it does not exist).
- Modify: `backend/src/routes/scheduling.js` — `priceAndStore` returns pricing & preserves manual edits; `PATCH /trips/:id/details` accepts `purpose`/`company_name`/`contact` and returns pricing; new `GET /quotes/:quoteNumber`; number-aware `GET /trips/:id`; `GET /quotes` list returns `quote_number`.

**Frontend:**
- Modify: `frontend/src/lib/easternTime.js` — add `easternInputParts(ms)` (UTC ms → `{date:'YYYY-MM-DD', clock:'HH:mm'}` Eastern) for loading existing leg times into the editor inputs.
- Modify: `frontend/src/lib/easternTime.test.js` — tests for `easternInputParts` (create if it does not exist).
- Create: `frontend/src/pages/QuoteEditor.jsx` — the streamlined quote-editing page.
- Create: `frontend/src/pages/NewQuoteRedirect.jsx` — `/scheduling/new` creates a draft quote then redirects into the editor.
- Delete: `frontend/src/pages/SchedulingNewTrip.jsx` — absorbed by `QuoteEditor`.
- Modify: `frontend/src/App.jsx` — routes: `quotes/:quoteNo` → QuoteEditor; `new` → NewQuoteRedirect.
- Modify: `frontend/src/pages/SchedulingTripDetail.jsx` — resolve the route param to the uuid (`meta.id`) for all sub-resource/mutation calls; load passengers/documents after resolve; redirect quote-status rows to the quote editor; add a "← Quote N" cross-link.
- Modify: `frontend/src/pages/Scheduling.jsx` — QuotesView "View" → `/scheduling/quotes/:quoteNo`; "Book" navigates to `/scheduling/trips/:tripNo`.

**Docs:**
- Modify: `CLAUDE.md` — §19 (routes), §20 (frontend routes/pages), §2 (in-flight).

---

## PHASE 1 — BACKEND

### Task 1: `repriceFromBase` — preserve manual edits on a rate-card reprice

A rate-card reprice (after a leg/aircraft/purpose change) must keep the user's ad-hoc fees, FET on/off, and total override. This pure helper merges them onto a freshly-computed base.

**Files:**
- Modify: `backend/src/scheduling/pricing.js`
- Test: `backend/src/scheduling/pricing.test.js`

- [ ] **Step 1: Write the failing test**

Create or append to `backend/src/scheduling/pricing.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repriceFromBase } from './pricing.js';

// A freshly-computed rate-card breakdown (the shape priceTrip/priceQuoteLegs returns).
const fresh = () => ({
  hourlyRate: 8000, hours: 5, surchargePerHr: 500, faFee: 0, faCount: 0,
  crewFee: 0, crewCount: 0, landingFee: 1000, landings: 2,
  segmentPerPax: 50, pax: 10, overnightCost: 0, fetRate: 0.075,
  flightCost: 40000, surcharge: 2500, landingCost: 2000, segmentFee: 500,
  fetBase: 44500, fetAmount: 3338, total: 48338, rateName: 'N69FP CHARTER', tail: 'N69FP',
});

test('repriceFromBase: no manual edits returns the fresh base unchanged', () => {
  const out = repriceFromBase(fresh(), {});
  assert.equal(out.total, 48338);
  assert.ok(!out.manual);
});

test('repriceFromBase: preserves a total override (override wins)', () => {
  const out = repriceFromBase(fresh(), { totalOverride: 60000 });
  assert.equal(out.totalOverride, 60000);
  assert.equal(out.total, 60000);
  assert.equal(out.manual, true);
});

test('repriceFromBase: preserves ad-hoc fees and adds them to the total', () => {
  const out = repriceFromBase(fresh(), { fees: [{ code: 'Catering', amount: 600, taxable: false }] });
  assert.equal(out.fees.length, 1);
  assert.equal(out.feesNonTaxable, 600);
  assert.equal(out.total, 48338 + 600); // non-taxable fee added after FET
  assert.equal(out.manual, true);
});

test('repriceFromBase: preserves FET off (owner)', () => {
  const out = repriceFromBase(fresh(), { fetEnabled: false });
  assert.equal(out.fetAmount, 0);
  assert.equal(out.total, 44500 + 500); // fetBase + segmentFee, no FET
  assert.equal(out.manual, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test backend/src/scheduling/pricing.test.js`
Expected: FAIL — `repriceFromBase` is not exported.

- [ ] **Step 3: Implement `repriceFromBase`**

In `backend/src/scheduling/pricing.js`, append at the end of the file (it already exports `recomputeFromInputs`):

```javascript
// After a rate-card reprice (leg/aircraft/purpose change), keep the user's manual
// ad-hoc fees, FET on/off, and total override, recomputing so the override still
// wins. Returns the fresh base untouched when there were no manual edits.
export const repriceFromBase = (fresh, old = {}) => {
  const o = old && !old.error ? old : {};
  const hasManual = o.manual === true
    || (Array.isArray(o.fees) && o.fees.length > 0)
    || (o.totalOverride !== null && o.totalOverride !== undefined && o.totalOverride !== '')
    || o.fetEnabled === false;
  if (!hasManual) return fresh;
  const inputs = {
    hourlyRate: fresh.hourlyRate, hours: fresh.hours, surchargePerHr: fresh.surchargePerHr,
    faFee: fresh.faFee, faCount: fresh.faCount, crewFee: fresh.crewFee, crewCount: fresh.crewCount,
    landingFee: fresh.landingFee, landings: fresh.landings,
    segmentPerPax: fresh.segmentPerPax, pax: fresh.pax, overnightCost: fresh.overnightCost,
    fetRate: fresh.fetRate,
    fees: Array.isArray(o.fees) ? o.fees : [],
    fetEnabled: o.fetEnabled !== false,
    totalOverride: o.totalOverride ?? null,
  };
  return { ...fresh, ...inputs, ...recomputeFromInputs(inputs), manual: true };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test backend/src/scheduling/pricing.test.js`
Expected: PASS (all 4 new tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/scheduling/pricing.js backend/src/scheduling/pricing.test.js
git commit -m "feat(pricing): repriceFromBase preserves manual fees/FET/override on reprice"
```

---

### Task 2: `tripParam.js` — resolve a route param to a Supabase column

The trip page URL becomes a `trip_number`. Reads must resolve uuid / 24-hex lf_oid / trip_number to the right column.

**Files:**
- Create: `backend/src/scheduling/tripParam.js`
- Test: `backend/src/scheduling/tripParam.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/src/scheduling/tripParam.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tripParamColumn } from './tripParam.js';

test('tripParamColumn: a uuid resolves to the id column', () => {
  assert.equal(tripParamColumn('3f1a2b3c-4d5e-6f70-8190-a1b2c3d4e5f6'), 'id');
});

test('tripParamColumn: a 24-hex LevelFlight oid resolves to lf_oid', () => {
  assert.equal(tripParamColumn('652f1a2b3c4d5e6f70819011'), 'lf_oid');
});

test('tripParamColumn: a bare number resolves to trip_number', () => {
  assert.equal(tripParamColumn('26000'), 'trip_number');
});

test('tripParamColumn: empty/garbage falls back to trip_number', () => {
  assert.equal(tripParamColumn(''), 'trip_number');
  assert.equal(tripParamColumn('Trip-26000'), 'trip_number');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test backend/src/scheduling/tripParam.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `tripParam.js`**

Create `backend/src/scheduling/tripParam.js`:

```javascript
// Map a trip route param to the scheduling_trips column to filter on.
// Mirrored trips are addressed by their 24-hex LevelFlight oid, native trips by
// uuid, and (new) booked trips by their provisional trip_number when neither
// shape matches. trip_number is TEXT — compare as TEXT, never via SQL ORDER BY.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OID_RE = /^[0-9a-f]{24}$/i;

export function tripParamColumn(param) {
  const p = String(param || '');
  if (UUID_RE.test(p)) return 'id';
  if (OID_RE.test(p)) return 'lf_oid';
  return 'trip_number';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test backend/src/scheduling/tripParam.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/scheduling/tripParam.js backend/src/scheduling/tripParam.test.js
git commit -m "feat(scheduling): tripParamColumn resolves uuid/lf_oid/trip_number for reads"
```

---

### Task 3: Wire backend routes — number resolution, client-info+purpose on /details, reprice preservation, quotes list

**Files:**
- Modify: `backend/src/routes/scheduling.js`

- [ ] **Step 1: Import the new helpers**

In `backend/src/routes/scheduling.js`, the import block (lines 15-17) currently reads:

```javascript
import { priceQuoteLegs, legMinutes } from '../scheduling/priceQuote.js';
import { nextQuoteNumber, nextTripNumber } from '../scheduling/numbering.js';
import { recomputeFromInputs } from '../scheduling/pricing.js';
```

Replace those three lines with:

```javascript
import { priceQuoteLegs, legMinutes } from '../scheduling/priceQuote.js';
import { nextQuoteNumber, nextTripNumber } from '../scheduling/numbering.js';
import { recomputeFromInputs, repriceFromBase } from '../scheduling/pricing.js';
import { tripParamColumn } from '../scheduling/tripParam.js';
```

- [ ] **Step 2: `priceAndStore` returns pricing & preserves manual edits**

Replace the whole `priceAndStore` function (currently lines 240-250):

```javascript
// Price a native trip from its input legs (best-effort) and persist the breakdown.
async function priceAndStore(tripId, aircraft_tail, inputLegs, purpose = null) {
  try {
    const pricing = await priceQuoteLegs({
      tail: aircraft_tail, aircraftType: null,
      legs: inputLegs.map((l) => ({ dep_icao: (l.dep_icao || '').trim().toUpperCase(), arr_icao: (l.arr_icao || '').trim().toUpperCase(), pax: Number(l.pax) || 0, isPositioning: !!l.positioning })),
      nights: 0, purpose,
    });
    await supabase.from('scheduling_trips').update({ pricing, rate_name: pricing.rateName || null }).eq('id', tripId);
  } catch (pe) { console.warn('[scheduling price] failed:', pe?.message || pe); }
}
```

with:

```javascript
// Price a native trip from its input legs (best-effort) and persist the breakdown.
// A reprice keeps any manual ad-hoc fees / FET-off / total override the quote
// already had (repriceFromBase). Returns the stored pricing (or null on failure).
async function priceAndStore(tripId, aircraft_tail, inputLegs, purpose = null) {
  try {
    const fresh = await priceQuoteLegs({
      tail: aircraft_tail, aircraftType: null,
      legs: inputLegs.map((l) => ({ dep_icao: (l.dep_icao || '').trim().toUpperCase(), arr_icao: (l.arr_icao || '').trim().toUpperCase(), pax: Number(l.pax) || 0, isPositioning: !!l.positioning })),
      nights: 0, purpose,
    });
    const { data: cur } = await supabase.from('scheduling_trips').select('pricing').eq('id', tripId).single();
    const pricing = repriceFromBase(fresh, cur?.pricing || {});
    await supabase.from('scheduling_trips').update({ pricing, rate_name: pricing.rateName || null }).eq('id', tripId);
    return pricing;
  } catch (pe) { console.warn('[scheduling price] failed:', pe?.message || pe); return null; }
}
```

- [ ] **Step 3: `PATCH /trips/:id/details` accepts purpose/company_name/contact and returns pricing**

Replace the body of the `/details` handler (currently lines 327-343, from `const body = req.body || {};` through `res.json({ ok: true });`):

```javascript
    const body = req.body || {};
    const aircraft_tail = (body.aircraft_tail || '').trim() || null;
    const customer_name = (body.customer_name || '').trim() || null;
    const inputLegs = Array.isArray(body.legs) ? body.legs : [];
    if (!inputLegs.length) return res.status(400).json({ error: 'A trip needs at least one leg.' });

    // Editable quote header fields (only applied when present in the body).
    const tripPatch = { modified_at: new Date().toISOString(), modified_by: req.user?.email || null };
    if ('purpose' in body) tripPatch.purpose = (body.purpose || '').trim() || null;
    if ('company_name' in body) tripPatch.company_name = (body.company_name || '').trim() || null;
    if ('contact' in body) tripPatch.contact = (body.contact && typeof body.contact === 'object' && !Array.isArray(body.contact)) ? body.contact : null;
    const purpose = 'purpose' in body ? tripPatch.purpose : trip.purpose;

    const ctx = { id: trip.id, trip_number: trip.trip_number, status: trip.status, aircraft_tail, customer_name };
    const legRows = await buildNativeLegRows(trip.id, ctx, inputLegs);
    // Replace the leg set: delete existing, insert the new ones.
    const { error: de } = await supabase.from('scheduling_legs').delete().eq('trip_id', trip.id);
    if (de) throw de;
    const { error: ie } = await supabase.from('scheduling_legs').insert(legRows);
    if (ie) throw ie;

    await supabase.from('scheduling_trips').update(tripPatch).eq('id', trip.id);
    const pricing = await priceAndStore(trip.id, aircraft_tail, inputLegs, purpose);
    res.json({ ok: true, pricing });
```

(Note: the `.select('id, origin, trip_number, status, purpose')` at the top of the handler, line 323, already loads `purpose` — no change needed there.)

- [ ] **Step 4: Add `GET /quotes/:quoteNumber` and make `GET /quotes` return quote_number**

In the `GET /quotes` list handler, the `.select(...)` (line 151) currently reads:

```javascript
      .from('scheduling_trips').select('id, lf_oid, trip_number, status, origin, pricing').eq('status', 'quote');
```

Replace with (add `quote_number`):

```javascript
      .from('scheduling_trips').select('id, lf_oid, trip_number, quote_number, status, origin, pricing').eq('status', 'quote');
```

And in the `quotes.map(...)` (line 163-165), change the mapped object to include `quote_number`:

```javascript
    const quotes = trips.map((t) => ({
      id: t.id, lf_oid: t.lf_oid, trip_number: t.trip_number, quote_number: t.quote_number, total: t.pricing && !t.pricing.error ? t.pricing.total : null, ...quoteSummary(byTrip.get(t.id) || []),
    }));
```

Then add a new route. Insert it immediately AFTER the `GET /quotes` handler closes (after its closing `});`, around line 171), so it does not shadow the list route:

```javascript
// GET /api/scheduling/quotes/:quoteNumber — resolve a quote by its Quote # and
// return the same { trip, legs } payload as GET /trips/:id (powers the QuoteEditor).
router.get('/quotes/:quoteNumber', async (req, res) => {
  try {
    const { data: row, error } = await supabase
      .from('scheduling_trips').select('id, ' + TRIP_COLS).eq('quote_number', String(req.params.quoteNumber)).limit(1).maybeSingle();
    if (error) throw error;
    if (!row) return res.status(404).json({ error: 'Quote not found' });
    const { data: legRows, error: legErr } = await supabase
      .from('scheduling_legs')
      .select('lf_synced_snapshot, origin, locally_modified, upstream_changed')
      .eq('trip_id', row.id)
      .order('seq');
    if (legErr) throw legErr;
    res.json({ trip: shapeTrip(row), legs: mirrorLegsFromRows(legRows) });
  } catch (e) {
    console.error('GET /api/scheduling/quotes/:quoteNumber:', e.message);
    res.status(500).json({ error: 'Failed to load quote' });
  }
});
```

- [ ] **Step 5: Make `GET /trips/:id` number-aware**

In the `GET /trips/:lfOid` handler, the lookup (line 355-356) currently reads:

```javascript
    const { data: row, error } = await supabase
      .from('scheduling_trips').select('id, ' + TRIP_COLS).eq(tripColumn(req.params.lfOid), req.params.lfOid).single();
```

Replace with (use the number-aware resolver for this READ only; mutations still use `tripColumn`):

```javascript
    const { data: row, error } = await supabase
      .from('scheduling_trips').select('id, ' + TRIP_COLS).eq(tripParamColumn(req.params.lfOid), req.params.lfOid).single();
```

- [ ] **Step 6: Verify the backend boots and existing tests still pass**

Run: `node --check backend/src/routes/scheduling.js`
Expected: no output (syntax OK).

Run: `node --test backend/src/scheduling/*.test.js backend/src/services/*.test.js`
Expected: PASS (existing suite + the two new tests from Tasks 1-2).

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/scheduling.js
git commit -m "feat(scheduling): quote-number resolution, editable client info/purpose, reprice preservation"
```

---

## PHASE 2 — FRONTEND LIB

### Task 4: `easternInputParts` — UTC ms → Eastern date+clock for the editor inputs

The editor's `LegRow` uses split Eastern `date` + `clock` inputs. Loading an existing leg's stored UTC time needs the inverse of `easternToUTC`.

**Files:**
- Modify: `frontend/src/lib/easternTime.js`
- Test: `frontend/src/lib/easternTime.test.js`

- [ ] **Step 1: Write the failing test**

Create or append to `frontend/src/lib/easternTime.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { easternInputParts, easternToUTC } from './easternTime.js';

test('easternInputParts: summer instant converts to EDT (UTC-4)', () => {
  const ms = Date.parse('2026-06-20T18:30:00Z'); // 14:30 EDT
  assert.deepEqual(easternInputParts(ms), { date: '2026-06-20', clock: '14:30' });
});

test('easternInputParts: winter instant converts to EST (UTC-5)', () => {
  const ms = Date.parse('2026-01-15T18:30:00Z'); // 13:30 EST
  assert.deepEqual(easternInputParts(ms), { date: '2026-01-15', clock: '13:30' });
});

test('easternInputParts: round-trips through easternToUTC', () => {
  const ms = Date.parse('2026-06-20T18:30:00Z');
  const p = easternInputParts(ms);
  assert.equal(easternToUTC(p.date, p.clock).getTime(), ms);
});

test('easternInputParts: null/invalid returns empty fields', () => {
  assert.deepEqual(easternInputParts(null), { date: '', clock: '' });
  assert.deepEqual(easternInputParts(NaN), { date: '', clock: '' });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test frontend/src/lib/easternTime.test.js`
Expected: FAIL — `easternInputParts` not exported.

- [ ] **Step 3: Implement `easternInputParts`**

In `frontend/src/lib/easternTime.js`, append at the end of the file:

```javascript
// UTC epoch ms -> Eastern wall clock as input-field values:
// { date: 'YYYY-MM-DD', clock: 'HH:mm' } (DST-aware). Inverse of easternToUTC,
// used to load a stored leg time into the quote editor's date/time inputs.
export function easternInputParts(ms) {
  if (ms == null || isNaN(ms)) return { date: '', clock: '' };
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: ET, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(ms))) p[part.type] = part.value;
  const hour = p.hour === '24' ? '00' : p.hour; // Intl may emit '24' at midnight
  return { date: `${p.year}-${p.month}-${p.day}`, clock: `${hour}:${p.minute}` };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test frontend/src/lib/easternTime.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/easternTime.js frontend/src/lib/easternTime.test.js
git commit -m "feat(easternTime): easternInputParts for loading leg times into the editor"
```

---

## PHASE 3 — QUOTE EDITOR

### Task 5: Create `QuoteEditor.jsx`

The full streamlined quote page: load by Quote #, inline legs with flight time, editable client info, compact pricing, autosave, send buttons, Book, Discard.

**Files:**
- Create: `frontend/src/pages/QuoteEditor.jsx`

- [ ] **Step 1: Create the file with the complete component**

Create `frontend/src/pages/QuoteEditor.jsx`:

```jsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch, API_BASE } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { distinctClients } from '../lib/schedulingAggregate';
import AirportInput from '../components/AirportInput';
import FboPicker from '../components/trip/FboPicker';
import { easternToUTC, zuluParts, easternInputParts } from '../lib/easternTime';
import { recomputeInputs } from '../lib/feesMath';
import { FEE_CODES } from '../lib/feeCatalog';

const FLEET = ['N408JS', 'N69FP'];
const blankLeg = () => ({ dep_icao: '', arr_icao: '', dep_date: '', dep_clock: '', pax: '', positioning: false, dep_fbo: null, arr_fbo: null });
const legDepUTC = (l) => easternToUTC(l.dep_date, l.dep_clock);
const legDepIso = (l) => { const d = legDepUTC(l); return d ? d.toISOString() : ''; };
const toMs = (t) => (t == null ? null : (typeof t === 'number' ? t : Date.parse(t)));

const labelStyle = { fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 };
const inputStyle = { width: '100%', padding: '8px 10px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, boxSizing: 'border-box' };
const captionStyle = { fontSize: 10, marginTop: 3, minHeight: 13, whiteSpace: 'nowrap', color: 'var(--text-secondary)' };
const usd = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString());

// Live distance + flight time for a leg (debounced) — the working estimate engine.
function useLegEstimate(dep, arr, depIso) {
  const [est, setEst] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const a = (dep || '').trim(), b = (arr || '').trim();
    if (a.length < 3 || b.length < 3) { setEst(null); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const q = new URLSearchParams({ from: a, to: b });
        if (depIso) q.set('dep', depIso);
        const r = await apiFetch(`/api/scheduling/leg-estimate?${q.toString()}`);
        setEst(await r.json());
      } catch { setEst(null); }
      setLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [dep, arr, depIso]);
  return { est, loading };
}

function LegSummary({ est, loading }) {
  if (loading) return <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>calculating…</span>;
  if (!est) return null;
  if (est.distanceNm == null) return <span style={{ fontSize: 11, color: '#f59e0b' }}>airport not found — check the codes</span>;
  const h = Math.floor(est.minutes / 60), m = est.minutes % 60;
  return (
    <span style={{ fontSize: 11, color: 'var(--accent)' }}>
      ≈ {est.distanceNm.toLocaleString()} nm · {h}:{String(m).padStart(2, '0')} ETE{est.source === 'history' ? ' (from history)' : ''}
    </span>
  );
}

function LegRow({ leg, i, total, onUpdate, onRemove }) {
  const depUTC = legDepUTC(leg);
  const { est, loading } = useLegEstimate(leg.dep_icao, leg.arr_icao, depUTC ? depUTC.toISOString() : '');
  const z = zuluParts(depUTC);
  const etaZ = zuluParts(est?.arrTime ? new Date(est.arrTime) : null);
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 130px' }}><label style={labelStyle}>From</label><AirportInput value={leg.dep_icao} onChange={(v) => onUpdate(i, 'dep_icao', v)} placeholder="code or city" inputStyle={inputStyle} /></div>
      <div style={{ flex: '1 1 130px' }}>
        <label style={labelStyle}>To</label>
        <AirportInput value={leg.arr_icao} onChange={(v) => onUpdate(i, 'arr_icao', v)} placeholder="code or city" inputStyle={inputStyle} />
        <div style={{ ...captionStyle, color: 'var(--accent)' }}>{etaZ ? `ETA ${etaZ.date} · ${etaZ.time}Z` : ''}</div>
      </div>
      <div style={{ flex: '1 1 120px' }}>
        <label style={labelStyle}>Date</label>
        <input type="date" value={leg.dep_date} onChange={(e) => onUpdate(i, 'dep_date', e.target.value)} style={inputStyle} />
        <div style={captionStyle}>{z ? `${z.date} Z` : ''}</div>
      </div>
      <div style={{ flex: '0 1 100px' }}>
        <label style={labelStyle}>ETD local</label>
        <input type="time" value={leg.dep_clock} onChange={(e) => onUpdate(i, 'dep_clock', e.target.value)} style={inputStyle} />
        <div style={captionStyle}>{z ? `${z.time}Z` : ''}</div>
      </div>
      <div style={{ flex: '0 1 70px' }}><label style={labelStyle}>Pax</label><input type="number" min="0" value={leg.pax} onChange={(e) => onUpdate(i, 'pax', e.target.value)} placeholder="0" style={inputStyle} /></div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', marginTop: 22 }}><input type="checkbox" checked={leg.positioning} onChange={(e) => onUpdate(i, 'positioning', e.target.checked)} /> Ferry</label>
      <button onClick={() => onRemove(i)} disabled={total === 1} title="Remove leg"
        style={{ marginTop: 20, padding: '8px 10px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, cursor: total === 1 ? 'default' : 'pointer' }}>✕</button>
      <div style={{ flexBasis: '100%', display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
        <FboPicker label="Dep FBO" icao={leg.dep_icao} value={leg.dep_fbo} onChange={(fbo) => onUpdate(i, 'dep_fbo', fbo)} />
        <FboPicker label="Arr FBO" icao={leg.arr_icao} value={leg.arr_fbo} onChange={(fbo) => onUpdate(i, 'arr_fbo', fbo)} />
      </div>
      <div style={{ flexBasis: '100%', minHeight: 14 }}><LegSummary est={est} loading={loading} /></div>
    </div>
  );
}

// Convert a mirror leg (LF-shaped snapshot) into the editor's leg form.
function legToForm(l) {
  const p = easternInputParts(toMs(l.departure?.time));
  return {
    dep_icao: l.departure?.airport || '', arr_icao: l.arrival?.airport || '',
    dep_date: p.date, dep_clock: p.clock,
    pax: l.passengerCount ?? '', positioning: !!l.isPositioning,
    dep_fbo: l.departure?.fbo || null, arr_fbo: l.arrival?.fbo || null,
  };
}

// Build recomputeInputs() inputs from a persisted pricing breakdown + local fee edits.
function priceInputs(p, fees, fetEnabled, totalOverride) {
  const per = (rate, cost, qty) => (rate ?? (qty > 0 ? Math.round((cost || 0) / qty) : 0));
  const hours = p.hours ?? p.totalHrs ?? 0;
  return {
    hourlyRate: per(p.hourlyRate, p.flightCost, hours), hours, surchargePerHr: per(p.surchargePerHr, p.surcharge, hours),
    faFee: per(p.faFee, p.faCost, p.faCount), faCount: p.faCount || 0,
    crewFee: per(p.crewFee, p.crewCost, p.crewCount), crewCount: p.crewCount || 0,
    landingFee: per(p.landingFee, p.landingCost, p.landings), landings: p.landings || 0,
    segmentPerPax: per(p.segmentPerPax, p.segmentFee, p.pax), pax: p.pax || 0,
    overnightCost: p.overnightCost || 0, fetRate: p.fetRate || 0,
    fees, fetEnabled, totalOverride,
  };
}

export default function QuoteEditor() {
  const { quoteNo } = useParams();
  const navigate = useNavigate();
  const [trip, setTrip] = useState(null);
  const [legs, setLegs] = useState([]);
  const [tail, setTail] = useState(FLEET[0]);
  const [purpose, setPurpose] = useState('charter');
  const [company, setCompany] = useState('');
  const [contact, setContact] = useState({ name: '', email: '', phone: '' });
  const [pricing, setPricing] = useState(null);
  const [fees, setFees] = useState([]);
  const [fetEnabled, setFetEnabled] = useState(true);
  const [totalOverride, setTotalOverride] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);

  const { data: legsData } = useApi('/api/scheduling/legs');
  const clients = distinctClients(legsData?.legs || []);
  const { data: rateCards } = useApi('/api/rate-cards');
  const fleet = [...new Set((Array.isArray(rateCards) ? rateCards : []).map((c) => c.aircraft_tail).filter(Boolean))];
  const FLEET_OPTIONS = fleet.length ? fleet : FLEET;

  const tripId = trip?.id || null;
  const readOnly = trip && trip.status !== 'quote';

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/scheduling/quotes/${quoteNo}`);
      const j = await r.json();
      if (!r.ok || !j.trip) { setError(j.error || 'Quote not found'); return; }
      loaded.current = false;
      setTrip(j.trip);
      setTail(j.trip.lf_synced_snapshot?.dispatch?.aircraft?.tailNumber || (j.legs?.[0]?.dispatch?.aircraft?.tailNumber) || FLEET[0]);
      setPurpose(j.trip.purpose || 'charter');
      setCompany(j.trip.company_name || '');
      setContact(j.trip.contact && typeof j.trip.contact === 'object' ? { name: j.trip.contact.name || '', email: j.trip.contact.email || '', phone: j.trip.contact.phone || '' } : { name: '', email: '', phone: '' });
      const p = j.trip.pricing && !j.trip.pricing.error ? j.trip.pricing : null;
      setPricing(p);
      setFees(Array.isArray(p?.fees) ? p.fees.map((f) => ({ ...f })) : []);
      setFetEnabled(p ? p.fetEnabled !== false : (j.trip.purpose !== 'owner'));
      setTotalOverride(p?.totalOverride ?? null);
      setLegs((j.legs || []).map(legToForm));
      if (!j.legs?.length) setLegs([blankLeg()]);
      // allow autosave effects to run after this paint settles
      setTimeout(() => { loaded.current = true; }, 0);
    } catch (e) { setError(e.message); }
  }, [quoteNo]);
  useEffect(() => { load(); }, [load]);

  const updateLeg = (i, field, value) => setLegs((ls) => ls.map((l, idx) => {
    if (idx === i) return { ...l, [field]: value };
    if (field === 'arr_icao' && idx === i + 1 && !l.dep_icao) return { ...l, dep_icao: value };
    return l;
  }));
  const addLeg = () => setLegs((ls) => [...ls, { ...blankLeg(), dep_icao: ls[ls.length - 1]?.arr_icao || '' }]);
  const removeLeg = (i) => setLegs((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));

  const cleanedLegs = legs
    .filter((l) => (l.dep_icao || '').trim() && (l.arr_icao || '').trim())
    .map((l) => ({ dep_icao: l.dep_icao.trim(), arr_icao: l.arr_icao.trim(), dep_time: legDepIso(l), pax: l.pax, positioning: l.positioning, dep_fbo: l.dep_fbo || null, arr_fbo: l.arr_fbo || null }));

  // Autosave the quote header + legs (debounced) — reprices, preserving fees/override.
  const detailsKey = JSON.stringify({ tail, purpose, company, contact, legs: cleanedLegs });
  useEffect(() => {
    if (!loaded.current || !tripId || readOnly || !cleanedLegs.length) return;
    const t = setTimeout(async () => {
      setSaveState('saving'); setError(null);
      try {
        const r = await apiFetch(`/api/scheduling/trips/${tripId}/details`, {
          method: 'PATCH',
          body: JSON.stringify({ aircraft_tail: tail, customer_name: company, company_name: company, contact, purpose, legs: cleanedLegs }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `Save failed (${r.status})`);
        if (j.pricing) setPricing(j.pricing && !j.pricing.error ? j.pricing : null);
        setSaveState('saved');
      } catch (e) { setError(e.message); setSaveState('error'); }
    }, 700);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailsKey]);

  // Autosave pricing controls (ad-hoc fees / FET / override), debounced.
  const priceKey = JSON.stringify({ fees, fetEnabled, totalOverride });
  useEffect(() => {
    if (!loaded.current || !tripId || readOnly) return;
    const t = setTimeout(async () => {
      setSaveState('saving'); setError(null);
      try {
        const r = await apiFetch(`/api/scheduling/trips/${tripId}/price-lines`, {
          method: 'PATCH',
          body: JSON.stringify({ fees, fetEnabled, totalOverride }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `Save failed (${r.status})`);
        if (j.pricing) setPricing(j.pricing);
        setSaveState('saved');
      } catch (e) { setError(e.message); setSaveState('error'); }
    }, 700);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceKey]);

  const updateFee = (idx, field, value) => setFees((d) => d.map((f, i) => (i === idx ? { ...f, [field]: value } : f)));
  const addFee = () => setFees((d) => [...d, { code: FEE_CODES[0], description: '', amount: 0, taxable: true }]);
  const removeFee = (idx) => setFees((d) => d.filter((_, i) => i !== idx));
  const clearOverride = () => setTotalOverride(null);

  const book = async () => {
    setBusy(true); setError(null);
    try {
      const r = await apiFetch(`/api/scheduling/trips/${tripId}`, { method: 'PATCH', body: JSON.stringify({ status: 'booked' }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Book failed (${r.status})`);
      navigate(`/scheduling/trips/${j.trip.trip_number || tripId}`);
    } catch (e) { setError(e.message); setBusy(false); }
  };
  const discard = async () => {
    if (!window.confirm('Discard this quote permanently? This cannot be undone.')) return;
    setBusy(true); setError(null);
    try {
      const r = await apiFetch(`/api/scheduling/trips/${tripId}`, { method: 'DELETE' });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Delete failed (${r.status})`); }
      navigate('/scheduling');
    } catch (e) { setError(e.message); setBusy(false); }
  };

  const live = pricing ? recomputeInputs(priceInputs(pricing, fees, fetEnabled, totalOverride)) : null;
  const saveLabel = { idle: '', saving: 'Saving…', saved: 'Saved ✓', error: 'Save failed' }[saveState];
  const saveColor = saveState === 'error' ? 'var(--danger)' : 'var(--text-secondary)';

  if (!trip && !error) return <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading quote…</p>;

  const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 };
  const sendBtns = (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <a href={`${API_BASE}/quote/${tripId}`} target="_blank" rel="noopener noreferrer"
        style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: '#fff', borderRadius: 8, textDecoration: 'none' }}>View Quote ↗</a>
      <a href={`${API_BASE}/quote/${tripId}/pdf`} target="_blank" rel="noopener noreferrer"
        style={{ padding: '8px 14px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, textDecoration: 'none' }}>Quote PDF ↗</a>
      <button onClick={() => navigator.clipboard?.writeText(`${API_BASE}/quote/${tripId}`)}
        style={{ padding: '8px 14px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>Copy client link</button>
    </div>
  );

  return (
    <div style={{ maxWidth: 920 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/scheduling')}
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}>← Scheduling</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-primary)' }}>Quote {trip?.quote_number || quoteNo}</h1>
          {readOnly && trip?.trip_number && (
            <button onClick={() => navigate(`/scheduling/trips/${trip.trip_number}`)}
              style={{ marginTop: 4, fontSize: 13, color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>Booked as Trip {trip.trip_number} →</button>
          )}
        </div>
        {!readOnly && <span style={{ fontSize: 12, color: saveColor, minWidth: 70, textAlign: 'right' }}>{saveLabel}</span>}
      </div>

      {error && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '12px 16px', color: 'var(--danger)', marginBottom: 16 }}>{error}</div>}

      {readOnly ? (
        <div style={card}>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>This quote has been booked. Editing happens on the trip page; the quote stays available to send.</p>
          {sendBtns}
        </div>
      ) : (<>
        <div style={{ ...card, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 150px' }}>
            <label style={labelStyle}>Aircraft</label>
            <select value={tail} onChange={(e) => setTail(e.target.value)} style={inputStyle}>
              {FLEET_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <label style={labelStyle}>Purpose</label>
            <select value={purpose} onChange={(e) => setPurpose(e.target.value)} style={inputStyle}>
              <option value="charter">Charter</option>
              <option value="owner">Owner</option>
            </select>
          </div>
          <div style={{ flex: '2 1 220px' }}>
            <label style={labelStyle}>Company</label>
            <input list="qe-clients" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company or client" style={inputStyle} />
            <datalist id="qe-clients">{clients.map((c) => <option key={c.name} value={c.name} />)}</datalist>
          </div>
          <div style={{ flex: '1 1 100%', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 180px' }}><label style={labelStyle}>Contact name</label><input value={contact.name} onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))} placeholder="Jane Smith" style={inputStyle} /></div>
            <div style={{ flex: '1 1 180px' }}><label style={labelStyle}>Contact email</label><input value={contact.email} onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))} placeholder="jane@company.com" style={inputStyle} /></div>
            <div style={{ flex: '1 1 140px' }}><label style={labelStyle}>Contact phone</label><input value={contact.phone} onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))} placeholder="(305) 555-0100" style={inputStyle} /></div>
          </div>
        </div>

        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>Legs</div>
          {legs.map((l, i) => (
            <LegRow key={i} leg={l} i={i} total={legs.length} onUpdate={updateLeg} onRemove={removeLeg} />
          ))}
          <button onClick={addLeg}
            style={{ marginTop: 4, padding: '6px 14px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>+ Add leg</button>
          <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 10 }}>ETD is local Eastern (Zulu shown beneath); the ETA under each arrival comes from the flight-time engine.</p>
        </div>

        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Pricing — {usd(live?.total)}{totalOverride != null ? ' · adjusted' : ''}</span>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{pricing?.rateName || (purpose === 'owner' ? 'Owner rate' : 'Charter rate')}</span>
          </div>
          {!pricing ? (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Add a leg with a From and To to price the quote.</p>
          ) : (
            <table style={{ width: '100%', fontSize: 13, color: 'var(--text-secondary)', borderCollapse: 'collapse' }}>
              <tbody>
                <tr><td style={{ padding: '3px 0' }}>Flight cost</td><td style={{ textAlign: 'right' }}>{usd(live.flightCost)}</td></tr>
                {live.surcharge > 0 && <tr><td>Fuel surcharge</td><td style={{ textAlign: 'right' }}>{usd(live.surcharge)}</td></tr>}
                {live.landingCost > 0 && <tr><td>Landings ({pricing.landings})</td><td style={{ textAlign: 'right' }}>{usd(live.landingCost)}</td></tr>}
                {live.segmentFee > 0 && <tr><td>Segment fees</td><td style={{ textAlign: 'right' }}>{usd(live.segmentFee)}</td></tr>}
                <tr><td colSpan={2} style={{ paddingTop: 10, fontSize: 11, fontWeight: 600, letterSpacing: '.04em' }}>AD-HOC FEES</td></tr>
                {fees.map((f, i) => (
                  <tr key={i}>
                    <td style={{ padding: '3px 0' }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <select value={f.code || ''} onChange={(e) => updateFee(i, 'code', e.target.value)} style={{ ...inputStyle, width: 'auto', padding: '4px 6px', fontSize: 12 }}>
                          {FEE_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <input value={f.description || ''} onChange={(e) => updateFee(i, 'description', e.target.value)} placeholder="Description" style={{ ...inputStyle, width: 'auto', padding: '4px 6px', fontSize: 12, flex: '1 1 120px' }} />
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}><input type="checkbox" checked={!!f.taxable} onChange={(e) => updateFee(i, 'taxable', e.target.checked)} /> Taxable</label>
                        <button onClick={() => removeFee(i)} style={{ padding: '2px 7px', fontSize: 11, background: 'var(--bg-secondary)', color: 'var(--danger)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>✕</button>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input type="number" value={f.amount} onChange={(e) => updateFee(i, 'amount', e.target.value)} style={{ width: 78, textAlign: 'right', padding: '2px 5px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 5 }} />
                    </td>
                  </tr>
                ))}
                <tr><td colSpan={2} style={{ padding: '4px 0' }}>
                  <button onClick={addFee} style={{ padding: '4px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>+ New Fee</button>
                </td></tr>
                <tr>
                  <td><label style={{ display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={fetEnabled} onChange={(e) => setFetEnabled(e.target.checked)} /> FET ({Math.round((pricing.fetRate || 0) * 1000) / 10}%)</label></td>
                  <td style={{ textAlign: 'right' }}>{usd(live.fetAmount)}</td>
                </tr>
                <tr>
                  <td style={{ paddingTop: 6, fontWeight: 700, color: 'var(--text-primary)' }}>Total{totalOverride != null ? ' · adjusted' : ''}</td>
                  <td style={{ paddingTop: 6, textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                      <input type="number" value={totalOverride ?? ''} placeholder={String(live.computedTotal)}
                        onChange={(e) => setTotalOverride(e.target.value === '' ? null : e.target.value)}
                        style={{ width: 96, textAlign: 'right', padding: '2px 5px', fontSize: 13, fontWeight: 700, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 5 }} />
                      {totalOverride != null && totalOverride !== '' &&
                        <button title="Clear override" onClick={clearOverride} style={{ padding: '2px 7px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>↺</button>}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {sendBtns}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={discard} disabled={busy} title="Discard this quote"
              style={{ padding: '9px 16px', fontSize: 13, background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, cursor: 'pointer' }}>Discard</button>
            <button onClick={book} disabled={busy}
              style={{ padding: '9px 20px', fontSize: 14, fontWeight: 600, background: '#a855f7', color: '#fff', border: 'none', borderRadius: 8, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Booking…' : 'Book trip'}
            </button>
          </div>
        </div>
      </>)}
    </div>
  );
}
```

- [ ] **Step 2: Type/syntax check via the frontend build (done after routing is wired in Task 6)**

This component is not reachable until Task 6 wires the route. Proceed to Task 6, then run the build there.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/QuoteEditor.jsx
git commit -m "feat(scheduling): QuoteEditor page (inline legs, flight time, client info, autosave)"
```

---

### Task 6: Wire routing + the New Quote draft redirect; remove SchedulingNewTrip

**Files:**
- Create: `frontend/src/pages/NewQuoteRedirect.jsx`
- Modify: `frontend/src/App.jsx`
- Delete: `frontend/src/pages/SchedulingNewTrip.jsx`

- [ ] **Step 1: Create the draft-and-redirect component**

Create `frontend/src/pages/NewQuoteRedirect.jsx`:

```jsx
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';

const FLEET = ['N408JS', 'N69FP'];

// Creating a quote makes a draft scheduling_trips row immediately (so it has a
// Quote # to autosave into), then drops the user into the QuoteEditor.
export default function NewQuoteRedirect() {
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const r = await apiFetch('/api/scheduling/trips', {
          method: 'POST',
          body: JSON.stringify({ aircraft_tail: FLEET[0], purpose: 'charter', legs: [{ dep_icao: '', arr_icao: '' }] }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `Create failed (${r.status})`);
        navigate(`/scheduling/quotes/${j.trip.quote_number}`, { replace: true });
      } catch (e) { setError(e.message); }
    })();
  }, [navigate]);

  if (error) return (
    <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '12px 16px', color: 'var(--danger)' }}>{error}</div>
  );
  return <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Creating quote…</p>;
}
```

- [ ] **Step 2: Update App.jsx routes**

In `frontend/src/App.jsx`, the import for `SchedulingNewTrip` exists near the other page imports. Find it (it imports from `./pages/SchedulingNewTrip`) and replace that single import line with:

```jsx
import QuoteEditor from './pages/QuoteEditor';
import NewQuoteRedirect from './pages/NewQuoteRedirect';
```

Then in the `SchedulingApp` `<Routes>` block (lines 97-103), replace:

```jsx
          <Route index element={<Scheduling />} />
          <Route path="new" element={<SchedulingNewTrip />} />
          <Route path="trips/:id" element={<SchedulingTripDetail />} />
```

with:

```jsx
          <Route index element={<Scheduling />} />
          <Route path="new" element={<NewQuoteRedirect />} />
          <Route path="quotes/:quoteNo" element={<QuoteEditor />} />
          <Route path="trips/:id" element={<SchedulingTripDetail />} />
```

- [ ] **Step 3: Delete the absorbed page**

```bash
git rm frontend/src/pages/SchedulingNewTrip.jsx
```

- [ ] **Step 4: Build to verify everything compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds (no unresolved imports; `SchedulingNewTrip` is no longer referenced).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx frontend/src/pages/NewQuoteRedirect.jsx
git commit -m "feat(scheduling): route quotes/:quoteNo to QuoteEditor; New Quote creates a draft"
```

---

### Task 7: Update the Scheduling hub QuotesView links

**Files:**
- Modify: `frontend/src/pages/Scheduling.jsx`

- [ ] **Step 1: Point "View" at the quote editor and "Book" at the trip number**

In `frontend/src/pages/Scheduling.jsx`, the `book` function (lines 98-107) currently navigates to `/scheduling/trips/${id}`. Replace the whole `book` function with:

```jsx
  const book = async (id) => {
    setBusyId(id); setError(null);
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'booked' }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Book failed (${r.status})`);
      navigate(`/scheduling/trips/${j.trip?.trip_number || id}`); // it's a booked trip now
      return;
    } catch (e) { setError(e.message); }
    setBusyId(null);
  };
```

Then the "View" button (line 144) currently reads:

```jsx
                <button onClick={() => navigate(`/scheduling/trips/${q.id}`)}
```

Replace with (open the quote editor by Quote #, falling back to the uuid trip page if a quote somehow has no number):

```jsx
                <button onClick={() => navigate(q.quote_number ? `/scheduling/quotes/${q.quote_number}` : `/scheduling/trips/${q.id}`)}
```

- [ ] **Step 2: Build to verify**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Scheduling.jsx
git commit -m "feat(scheduling): hub Quotes view links to the quote editor; Book navigates by trip number"
```

---

## PHASE 4 — BOOKED TRIP PAGE

### Task 8: Resolve trip_number → uuid in SchedulingTripDetail; redirect quotes; cross-link

The trip page URL is now a `trip_number` (or uuid). The page resolves it to the row uuid (`meta.id`) and uses that uuid for every sub-resource/mutation call, so all uuid-forking downstream calls keep working. Quote-status rows redirect to the quote editor.

**Files:**
- Modify: `frontend/src/pages/SchedulingTripDetail.jsx`

- [ ] **Step 1: Introduce the resolved uuid and redirect quotes**

In `frontend/src/pages/SchedulingTripDetail.jsx`, replace the `load` callback (lines 70-77):

```jsx
  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}`);
      const j = await r.json();
      if (j.trip) { setMeta(j.trip); setLegs(j.legs || []); }
      else setError(j.error || 'Trip not found');
    } catch (e) { setError(e.message); }
  }, [id]);
```

with (redirect quote-status rows to the quote editor):

```jsx
  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}`);
      const j = await r.json();
      if (j.trip) {
        if (j.trip.status === 'quote' && j.trip.quote_number) { navigate(`/scheduling/quotes/${j.trip.quote_number}`, { replace: true }); return; }
        setMeta(j.trip); setLegs(j.legs || []);
      } else setError(j.error || 'Trip not found');
    } catch (e) { setError(e.message); }
  }, [id, navigate]);
```

- [ ] **Step 2: Load passengers/documents by the resolved uuid, after meta is known**

Replace the `loadPassengers`/`loadDocuments` callbacks and their mount effect (lines 79-95). Current:

```jsx
  const loadPassengers = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}/passengers`);
      const j = await r.json();
      if (j.passengers) setPassengers(j.passengers);
    } catch { /* soft */ }
  }, [id]);

  const loadDocuments = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}/documents`);
      const j = await r.json();
      if (j.documents) setDocuments(j.documents);
    } catch { /* soft */ }
  }, [id]);

  useEffect(() => { load(); loadPassengers(); loadDocuments(); }, [load, loadPassengers, loadDocuments]);
```

Replace with (key passengers/documents on the resolved uuid `meta.id`):

```jsx
  const tripId = meta?.id || null;

  const loadPassengers = useCallback(async () => {
    if (!tripId) return;
    try {
      const r = await apiFetch(`/api/scheduling/trips/${tripId}/passengers`);
      const j = await r.json();
      if (j.passengers) setPassengers(j.passengers);
    } catch { /* soft */ }
  }, [tripId]);

  const loadDocuments = useCallback(async () => {
    if (!tripId) return;
    try {
      const r = await apiFetch(`/api/scheduling/trips/${tripId}/documents`);
      const j = await r.json();
      if (j.documents) setDocuments(j.documents);
    } catch { /* soft */ }
  }, [tripId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadPassengers(); loadDocuments(); }, [loadPassengers, loadDocuments]);
```

- [ ] **Step 3: Use the resolved uuid for every sub-resource/mutation call**

Within `SchedulingTripDetail.jsx`, every `/api/scheduling/trips/${id}/...` mutation/sub-resource call and the public quote links must use `tripId` instead of `id`. Make these exact replacements (the `id` from `useParams` stays only as the value passed into `load`'s URL):

In `uploadDoc` (line 107): `` `/api/scheduling/trips/${id}/documents` `` → `` `/api/scheduling/trips/${tripId}/documents` ``
In `setStatus` (line 129): `` `/api/scheduling/trips/${id}` `` → `` `/api/scheduling/trips/${tripId}` ``
In `revert` (line 139): `` `/api/scheduling/trips/${id}/revert` `` → `` `/api/scheduling/trips/${tripId}/revert` ``
In `deleteTrip` (line 150): `` `/api/scheduling/trips/${id}` `` → `` `/api/scheduling/trips/${tripId}` ``
In `reprice` (line 162): `` `/api/scheduling/trips/${id}/price` `` → `` `/api/scheduling/trips/${tripId}/price` ``
In `savePrice` (line 188): `` `/api/scheduling/trips/${id}/price-lines` `` → `` `/api/scheduling/trips/${tripId}/price-lines` ``
In `savePax` (line 283): `` `/api/scheduling/trips/${id}/passengers` `` → `` `/api/scheduling/trips/${tripId}/passengers` ``
In `saveDetails` (line 315): `` `/api/scheduling/trips/${id}/details` `` → `` `/api/scheduling/trips/${tripId}/details` ``
In `toggleChecklist` (line 337): `` `/api/scheduling/trips/${id}/checklist` `` → `` `/api/scheduling/trips/${tripId}/checklist` ``
In `saveCrew` (line 350): `` `/api/scheduling/trips/${id}/crew` `` → `` `/api/scheduling/trips/${tripId}/crew` ``

Also update the components/links that receive `id`:
- `ItinerarySendModal` (line 390): `<ItinerarySendModal dispatchId={id} ...>` → `<ItinerarySendModal dispatchId={tripId} ...>`
- `TripActionsRail` (line 384): `id={id}` → `id={tripId}`
- Docs-tab quote links (lines 679-684): the three occurrences of `${API_BASE}/quote/${id}` → `${API_BASE}/quote/${tripId}` (these must be the uuid so the public route renders the native quote VM).

> Note: `tripId` is defined in Step 2 and is non-null only after `meta` loads; every site above runs in response to user actions or in the docs/quote markup that renders after `meta` is set, so `tripId` is available. Leave the read in `load` using the route `id` (number-aware backend).

- [ ] **Step 4: Add the "← Quote N" cross-link in the subtitle**

The `subtitle` (lines 212-216) already includes `Quote ${meta.quote_number}` as plain text. Make it a link to the quote editor. Replace the subtitle paragraph (line 365):

```jsx
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{subtitle}</p>
```

with:

```jsx
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            {subtitle}
            {meta?.quote_number && <> · <button onClick={() => navigate(`/scheduling/quotes/${meta.quote_number}`)} style={{ fontSize: 13, color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>View quote ↗</button></>}
          </p>
```

And remove the now-duplicated `Quote ${meta?.quote_number}` entry from the `subtitle` array (line 214): delete the line `    meta?.quote_number ? \`Quote ${meta.quote_number}\` : null,`.

- [ ] **Step 5: Build to verify**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/SchedulingTripDetail.jsx
git commit -m "feat(scheduling): trip page resolves trip_number to uuid; redirect quotes; quote cross-link"
```

---

## PHASE 5 — DOCS & VERIFICATION

### Task 9: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: §19 route catalog — document the new/changed endpoints**

In `CLAUDE.md` §19, in the `scheduling.js` row's "Highlights" cell, add: `GET /quotes/:quoteNumber` (resolve a quote by Quote #), note `GET /trips/:id` now also resolves a `trip_number`, and `/details` now persists `purpose`/`company_name`/`contact` and returns `pricing`. Add `quote_number` to the `GET /quotes` list description.

- [ ] **Step 2: §20 frontend — document the route + page changes**

In `CLAUDE.md` §20, under "Scheduling routes": add `/scheduling/quotes/:quoteNo` (the QuoteEditor), note `/scheduling/new` now creates a draft quote then redirects, the trip route `:id` accepts a `trip_number` or uuid, and that `SchedulingNewTrip.jsx` was replaced by `QuoteEditor.jsx` + `NewQuoteRedirect.jsx`. Under "Notable pages" replace the `SchedulingNewTrip.jsx` mention with `QuoteEditor.jsx` (streamlined quote page: inline legs, flight time, client info, compact pricing, autosave; booked trips use `SchedulingTripDetail`).

- [ ] **Step 3: §2 current focus — mark in flight**

In `CLAUDE.md` §2, add a bullet under the Quoting→Dispatch revamp noting the quote/trip page split (Quote editor keyed by Quote #, booked trip keyed by Trip #, one row) shipped on `feat/quote-editor-trip-split`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md — quote editor / quote-trip split routes, pages, endpoints"
```

---

### Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite**

Run: `node --test backend/src/scheduling/*.test.js backend/src/services/*.test.js backend/src/services/fuel/*.test.js`
Expected: PASS, including `pricing.test.js` and `tripParam.test.js`.

- [ ] **Step 2: Run the frontend lib tests**

Run: `node --test frontend/src/lib/*.test.js`
Expected: PASS, including `easternTime.test.js`.

- [ ] **Step 3: Frontend build**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual smoke (document results, do not auto-claim success)**

With the backend running (`cd backend && npm run dev`) and frontend (`cd frontend && npm run dev`), verify in the browser:
- `/scheduling` → "+ New Quote" creates a draft and lands on `/scheduling/quotes/<n>`.
- Add/delete legs inline; each leg shows `≈ nm · h:mm ETE` and an ETA; "Saved ✓" appears after edits.
- Edit company/contact and pricing (add a fee, set an override) → persists on reload.
- "View Quote ↗" opens the dark quote document; "Book trip" navigates to `/scheduling/trips/<tripNumber>` showing the full tabbed page with a "View quote ↗" cross-link.
- Opening `/scheduling/trips/<tripNumber>` directly loads the booked trip; opening a quote's old uuid trip URL redirects to the quote editor.

- [ ] **Step 5: Final review of the working tree**

Run: `git status --short && git log --oneline -12`
Expected: all changes committed on `feat/quote-editor-trip-split`; the pre-existing `.gitignore` modification remains unstaged (untouched).

---

## Self-Review

**Spec coverage:**
- §1 two URLs/one row → Tasks 3 (resolution), 5/6 (quote route), 8 (trip route). ✓
- §2 status gates experience / redirects → Task 8 Step 1, QuoteEditor `readOnly`. ✓
- §3 quote contents (legs/flight time/pax/client/pricing/send; no pax-manifest/crew/docs/itinerary/sheet) → Task 5. ✓
- §4 per-leg pax → `LegRow` pax field (kept). ✓
- §5 auto-priced + light controls → Task 5 pricing panel. ✓
- §6 autosave + Saved ✓ → Task 5 debounced effects + indicator. ✓
- §7 quote document unchanged → reuses `${API_BASE}/quote/:uuid`. ✓
- §8 trip# keying + uuid back-compat → Tasks 2, 3 (GET), 8. ✓
- Backend: number resolution (Task 2/3), editable client info+purpose (Task 3), reprice preservation (Task 1/3). ✓
- Create flow (draft + Discard) → Task 6 + QuoteEditor `discard`. ✓
- Cross-links → Task 5 (booked banner) + Task 8 Step 4. ✓
- Testing → Tasks 1,2,4 unit tests; Task 10 suite + build. ✓
- Docs → Task 9. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. ✓

**Type consistency:** `tripParamColumn` (Task 2) used in Task 3 Step 5. `repriceFromBase(fresh, old)` (Task 1) used in Task 3 Step 2. `easternInputParts(ms)` (Task 4) used in `legToForm` (Task 5). `/details` returns `{ ok, pricing }` (Task 3 Step 3) consumed by QuoteEditor details autosave (Task 5). `/price-lines` returns `{ pricing }` (existing) consumed by QuoteEditor price autosave. `meta.id` (uuid) named `tripId` consistently in Task 8. `quote_number` added to `/quotes` list (Task 3 Step 4) consumed by hub View link (Task 7). ✓
