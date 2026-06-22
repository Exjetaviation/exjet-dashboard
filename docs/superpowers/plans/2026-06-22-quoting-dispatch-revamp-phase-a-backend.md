# Quoting → Dispatch Revamp — Phase A (Backend Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the native quote system Purpose-based rate cards and a full Fees model (ad-hoc taxable line items, FET on/off, manual total override, RON), and wire Company/Contact/Purpose and the Quote#→Trip# Book transition through the backend.

**Architecture:** The pricing engine (`scheduling/pricing.js`) stays the single source of truth; we extend its pure functions and add small pure helpers (`selectRateCard`, `numbering`) that are unit-tested with `node:test`. Route handlers in `routes/scheduling.js` and `routes/rateCards.js` are wired to the new columns. Schema lands in one manually-applied migration (`018`).

**Tech Stack:** Node + Express, Supabase (PostgREST client), `node:test`, React (rate-card UI).

**Phase context:** This is Phase A of three. Phase B = FBO directory + native document view-models; Phase C = the tabbed Trip Overview + New-Quote frontend. Each is a separate plan. Phase A is independently testable (pricing/selector/numbering units + manual route checks).

**Conventions (from `CLAUDE.md`):** Migrations are applied **manually** in the Supabase SQL editor — after writing `018`, ask the user to run it. Stores **soft-fail** if a column/table is absent. Never print `.env` or PII. Backend tests: `node --test backend/src/scheduling/*.test.js backend/src/services/*.test.js`.

---

## File Structure

**Create:**
- `backend/migrations/018_quoting_revamp.sql` — all schema for the whole feature.
- `backend/src/scheduling/pickRateCard.js` — pure `selectRateCard(cards, purpose)`.
- `backend/src/scheduling/pickRateCard.test.js` — its tests.
- `backend/src/scheduling/numbering.js` — pure `nextNumber(numbers, base)` + supabase wrappers.
- `backend/src/scheduling/numbering.test.js` — its tests.

**Modify:**
- `backend/src/scheduling/pricing.js` — extend `recomputeFromInputs` (ad-hoc fees, FET toggle, total override).
- `backend/src/scheduling/pricing.test.js` — new tests for the above (create if absent).
- `backend/src/scheduling/priceQuote.js` — select rate card by `(tail, purpose)`.
- `backend/src/routes/scheduling.js` — create (quote_number/purpose/company/contact), price-lines (fees/fet/override), status→booked (trip_number/booked_by/at), new checklist route, `TRIP_COLS`/`shapeTrip`.
- `backend/src/routes/rateCards.js` — order by `(aircraft_tail, purpose)`.
- `frontend/src/pages/RateCards.jsx` — add `label` + `purpose` fields.

---

## Task 1: Migration 018 (schema for the whole feature)

**Files:**
- Create: `backend/migrations/018_quoting_revamp.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 018_quoting_revamp.sql — Quoting → Dispatch revamp.
-- Apply manually in the Supabase SQL editor. Idempotent (IF NOT EXISTS).

-- Rate cards: owner vs charter per tail.
ALTER TABLE rate_cards ADD COLUMN IF NOT EXISTS label   text;
ALTER TABLE rate_cards ADD COLUMN IF NOT EXISTS purpose text;  -- 'owner' | 'charter' | null (default)

-- Native trip: company/contact, dispatch checklist, booked-by stamp.
ALTER TABLE scheduling_trips ADD COLUMN IF NOT EXISTS company_name text;
ALTER TABLE scheduling_trips ADD COLUMN IF NOT EXISTS contact      jsonb;       -- { name, email, phone }
ALTER TABLE scheduling_trips ADD COLUMN IF NOT EXISTS checklist    jsonb;       -- { contractReceived, paymentReceived, paymentProcessed }
ALTER TABLE scheduling_trips ADD COLUMN IF NOT EXISTS booked_by    text;
ALTER TABLE scheduling_trips ADD COLUMN IF NOT EXISTS booked_at    timestamptz;

-- FBO directory (bulk-imported from LevelFlight in Phase B).
CREATE TABLE IF NOT EXISTS airport_fbos (
  fbo_id    text PRIMARY KEY,
  icao      text NOT NULL,
  name      text,
  address   jsonb,
  lat       numeric,
  lng       numeric,
  phones    jsonb,
  fax       text,
  email     text,
  website   text,
  comms     jsonb,
  hours     text,
  raw       jsonb,
  synced_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS airport_fbos_icao_idx ON airport_fbos (icao);
```

- [ ] **Step 2: Verify the SQL parses (no DB access from here)**

Run: `grep -c "ADD COLUMN IF NOT EXISTS" backend/migrations/018_quoting_revamp.sql`
Expected: `7`

- [ ] **Step 3: Ask the user to apply it**

Tell the user: "Migration `018_quoting_revamp.sql` is written — please run it in the Supabase SQL editor. Stores soft-fail until it's applied, so the deploy is safe either way."

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/018_quoting_revamp.sql
git commit -m "feat(db): migration 018 — rate-card purpose, trip company/contact/checklist, airport_fbos"
```

---

## Task 2: Numbering helper (provisional Quote#/Trip# sequence)

**Files:**
- Create: `backend/src/scheduling/numbering.js`
- Test: `backend/src/scheduling/numbering.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextNumber } from './numbering.js';

test('nextNumber: empty list returns the base', () => {
  assert.equal(nextNumber([], 3000), 3000);
});

test('nextNumber: one above the max, ignoring non-numerics', () => {
  assert.equal(nextNumber(['3000', '3007', 'abc', null, 3002], 3000), 3008);
});

test('nextNumber: existing below base still respects base', () => {
  assert.equal(nextNumber(['12'], 26000), 26000);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test backend/src/scheduling/numbering.test.js`
Expected: FAIL — `Cannot find module './numbering.js'`.

- [ ] **Step 3: Write the implementation**

```js
import { supabase } from '../services/supabase.js';

// Pure: the next number = one above the largest numeric value present, but never
// below `base`. Provisional scheme — the real Quote#/Trip# numbering is decided
// during the LevelFlight cutoff.
export const nextNumber = (numbers, base) => {
  const max = (numbers || [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .reduce((m, v) => Math.max(m, v), base - 1);
  return max + 1;
};

const QUOTE_BASE = 3000;
const TRIP_BASE = 26000;

const fetchColumn = async (column) => {
  const { data, error } = await supabase.from('scheduling_trips').select(column);
  if (error) return []; // soft-fail: degrade to base on error
  return (data || []).map((r) => r[column]);
};

export const nextQuoteNumber = async () => nextNumber(await fetchColumn('quote_number'), QUOTE_BASE);
export const nextTripNumber = async () => nextNumber(await fetchColumn('trip_number'), TRIP_BASE);
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test backend/src/scheduling/numbering.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/scheduling/numbering.js backend/src/scheduling/numbering.test.js
git commit -m "feat(scheduling): provisional quote/trip numbering helper"
```

---

## Task 3: Rate-card selection by Purpose

**Files:**
- Create: `backend/src/scheduling/pickRateCard.js`
- Test: `backend/src/scheduling/pickRateCard.test.js`
- Modify: `backend/src/scheduling/priceQuote.js:42-45`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectRateCard } from './pickRateCard.js';

const owner   = { id: 'o', aircraft_tail: 'N69FP', purpose: 'owner',   label: 'N69FP' };
const charter = { id: 'c', aircraft_tail: 'N69FP', purpose: 'charter', label: 'N69FP CHARTER' };
const legacy  = { id: 'l', aircraft_tail: 'N69FP', purpose: null,      label: null };

test('selectRateCard: matches the purpose', () => {
  assert.equal(selectRateCard([owner, charter], 'charter').id, 'c');
  assert.equal(selectRateCard([owner, charter], 'owner').id, 'o');
});

test('selectRateCard: falls back to a purpose-less (default) card', () => {
  assert.equal(selectRateCard([legacy, charter], 'owner').id, 'l');
});

test('selectRateCard: falls back to the first card when nothing matches', () => {
  assert.equal(selectRateCard([charter], 'owner').id, 'c');
});

test('selectRateCard: empty list returns null', () => {
  assert.equal(selectRateCard([], 'owner'), null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test backend/src/scheduling/pickRateCard.test.js`
Expected: FAIL — `Cannot find module './pickRateCard.js'`.

- [ ] **Step 3: Write the implementation**

```js
// Pure selector: from all rate cards for one tail, pick the card for the requested
// purpose ('owner' | 'charter'); else a purpose-less (default) card; else the first.
export const selectRateCard = (cards, purpose) => {
  const list = Array.isArray(cards) ? cards : [];
  if (!list.length) return null;
  return (
    list.find((c) => c.purpose === purpose) ||
    list.find((c) => c.purpose == null || c.purpose === '') ||
    list[0]
  );
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test backend/src/scheduling/pickRateCard.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Use it in `priceQuote.js`**

Replace the single-card lookup (currently lines 42-45):

```js
// OLD:
//   const { data: rateCard } = await supabase
//     .from('rate_cards').select('*').eq('aircraft_tail', tail).maybeSingle();
//   if (!rateCard) return { error: `No rate card for ${tail || 'aircraft'}.` };
```

with (also update the signature to accept `purpose`):

```js
import { selectRateCard } from './pickRateCard.js';
// ...
export async function priceQuoteLegs({ tail, aircraftType, legs, nights = 0, purpose = null }) {
  const { data: cards } = await supabase
    .from('rate_cards').select('*').eq('aircraft_tail', tail);
  const rateCard = selectRateCard(cards, purpose);
  if (!rateCard) return { error: `No rate card for ${tail || 'aircraft'}.` };
```

(Leave the rest of `priceQuoteLegs` unchanged.)

- [ ] **Step 6: Run the whole scheduling suite to confirm nothing broke**

Run: `node --test backend/src/scheduling/*.test.js`
Expected: PASS (all, including the two new files).

- [ ] **Step 7: Commit**

```bash
git add backend/src/scheduling/pickRateCard.js backend/src/scheduling/pickRateCard.test.js backend/src/scheduling/priceQuote.js
git commit -m "feat(scheduling): select rate card by purpose (owner vs charter)"
```

---

## Task 4: Extend the Fees engine (ad-hoc fees, FET toggle, total override)

**Files:**
- Modify: `backend/src/scheduling/pricing.js:19-31` (`recomputeFromInputs`)
- Test: `backend/src/scheduling/pricing.test.js`

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recomputeFromInputs } from './pricing.js';

const baseInputs = {
  hourlyRate: 8500, hours: 2, surchargePerHr: 1800, faFee: 700, faCount: 1,
  crewFee: 0, crewCount: 0, landingFee: 0, landings: 2,
  segmentPerPax: 0, pax: 4, overnightCost: 1500, fetRate: 0.075,
};

test('taxable ad-hoc fee is added to the FET base', () => {
  const r = recomputeFromInputs({ ...baseInputs, fees: [{ amount: 1000, taxable: true }] });
  // fetBase = 17000 + 3600 + 0 + 700 + 0 + 1500 + 1000(taxable) = 23800
  assert.equal(r.fetBase, 23800);
  assert.equal(r.fetAmount, Math.round(23800 * 0.075)); // 1785
});

test('non-taxable fee is excluded from FET base but included in total', () => {
  const r = recomputeFromInputs({ ...baseInputs, fees: [{ amount: 1000, taxable: false }] });
  assert.equal(r.fetBase, 22800);          // no fee in base
  assert.equal(r.total, r.computedTotal);
  assert.equal(r.total, 22800 + r.fetAmount + 1000); // fee added after FET
});

test('FET toggle off zeroes the FET amount', () => {
  const r = recomputeFromInputs({ ...baseInputs, fetEnabled: false });
  assert.equal(r.fetAmount, 0);
});

test('totalOverride wins over the computed total', () => {
  const r = recomputeFromInputs({ ...baseInputs, totalOverride: 25000 });
  assert.equal(r.total, 25000);
  assert.equal(r.totalOverride, 25000);
  assert.ok(r.computedTotal !== 25000); // computed value still exposed
});

test('default (no fees, no flags) keeps FET on — backward compatible', () => {
  const r = recomputeFromInputs(baseInputs);
  assert.equal(r.fetAmount, Math.round(r.fetBase * 0.075));
  assert.equal(r.totalOverride, null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test backend/src/scheduling/pricing.test.js`
Expected: FAIL — `r.fetBase` is 22800 even with a taxable fee (current code ignores `fees`); `computedTotal`/`totalOverride` are `undefined`.

- [ ] **Step 3: Replace `recomputeFromInputs`**

```js
// Recompute the full breakdown from editable RATE inputs plus ad-hoc Fees.
// Taxable ad-hoc fees join the FET base; non-taxable fees are added after FET.
// `fetEnabled === false` disables FET (owner trips). `totalOverride` (when set)
// wins over the computed total (LevelFlight's editable TOTAL PRICE).
export const recomputeFromInputs = (i) => {
  const n = (v) => Number(v) || 0;
  const flightCost = Math.round(n(i.hourlyRate) * n(i.hours));
  const surcharge = Math.round(n(i.surchargePerHr) * n(i.hours));
  const faCost = Math.round(n(i.faFee) * n(i.faCount));
  const crewCost = Math.round(n(i.crewFee) * n(i.crewCount));
  const landingCost = Math.round(n(i.landingFee) * n(i.landings));
  const overnightCost = Math.round(n(i.overnightCost));
  const segmentFee = Math.round(n(i.segmentPerPax) * n(i.pax));

  const fees = Array.isArray(i.fees) ? i.fees : [];
  const feesTaxable = Math.round(fees.filter((f) => f.taxable).reduce((s, f) => s + n(f.amount), 0));
  const feesNonTaxable = Math.round(fees.filter((f) => !f.taxable).reduce((s, f) => s + n(f.amount), 0));

  const fetBase = flightCost + surcharge + landingCost + faCost + crewCost + overnightCost + feesTaxable;
  const fetEnabled = i.fetEnabled !== false;            // default ON; explicit false disables
  const fetAmount = fetEnabled ? Math.round(fetBase * n(i.fetRate)) : 0;
  const computedTotal = Math.round(fetBase + segmentFee + fetAmount + feesNonTaxable);

  const hasOverride = i.totalOverride !== null && i.totalOverride !== undefined && i.totalOverride !== '';
  const totalOverride = hasOverride ? Math.round(n(i.totalOverride)) : null;

  return {
    flightCost, surcharge, faCost, crewCost, landingCost, overnightCost, segmentFee,
    fees, feesTaxable, feesNonTaxable,
    fetEnabled, fetBase: Math.round(fetBase), fetAmount,
    computedTotal, totalOverride,
    total: hasOverride ? totalOverride : computedTotal,
  };
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test backend/src/scheduling/pricing.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/scheduling/pricing.js backend/src/scheduling/pricing.test.js
git commit -m "feat(pricing): ad-hoc fees, FET toggle, manual total override"
```

---

## Task 5: Persist the Fees tab (fees / FET toggle / override) in the price-lines route

**Files:**
- Modify: `backend/src/routes/scheduling.js:458-481` (`PATCH /trips/:lfOid/price-lines`)

- [ ] **Step 1: Replace the handler body that builds `inputs` and `pricing`**

Current code builds numeric `inputs` and calls `recomputeFromInputs(inputs)`. Add the three new fields so the whole Fees tab saves in one call:

```js
    const inputs = {
      hourlyRate: pick('hourlyRate'), hours: pick('hours'), surchargePerHr: pick('surchargePerHr'),
      faFee: pick('faFee'), faCount: pick('faCount'), crewFee: pick('crewFee'), crewCount: pick('crewCount'),
      landingFee: pick('landingFee'), landings: pick('landings'),
      segmentPerPax: pick('segmentPerPax'), pax: pick('pax'), overnightCost: pick('overnightCost'),
      fetRate: base.fetRate || 0,
      fees: Array.isArray(b.fees) ? b.fees : (base.fees || []),
      fetEnabled: b.fetEnabled === undefined ? (base.fetEnabled !== false) : !!b.fetEnabled,
      totalOverride: b.totalOverride === undefined ? (base.totalOverride ?? null) : b.totalOverride,
    };
    const pricing = { ...base, ...inputs, ...recomputeFromInputs(inputs), manual: true };
    await supabase.from('scheduling_trips').update({ pricing }).eq('id', trip.id);
    res.json({ pricing });
```

- [ ] **Step 2: Manual verification (route hits Supabase — not a unit test)**

With the backend running and a native quote's id, run:

```bash
curl -s -X PATCH "$API/api/scheduling/trips/$TRIP_ID/price-lines" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"fetEnabled":false,"fees":[{"code":"Catering","description":"x","amount":500,"taxable":true}],"totalOverride":null}'
```

Expected JSON: `pricing.fetAmount` is `0`, `pricing.feesTaxable` is `500`, and `pricing.fees` has one item. (Do not paste real `$JWT`/secrets into the transcript — structure only.)

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/scheduling.js
git commit -m "feat(scheduling): save ad-hoc fees, FET toggle, total override on the quote"
```

---

## Task 6: Wire Quote#, Purpose, Company/Contact through create + GET

**Files:**
- Modify: `backend/src/routes/scheduling.js` — `TRIP_COLS` (line 153), `shapeTrip` (168-185), `priceAndStore` (211-221), `POST /trips` (226-254)

- [ ] **Step 1: Add the new columns to `TRIP_COLS` and `shapeTrip`**

Replace line 153:

```js
const TRIP_COLS = 'lf_oid, trip_number, quote_number, status, purpose, rate_name, company_name, contact, checklist, booked_by, booked_at, locally_modified, upstream_changed, lf_synced_snapshot, origin, pricing';
```

In `shapeTrip`, add these fields to the returned object (alongside the existing ones):

```js
    quote_number: row.quote_number,
    purpose: row.purpose,
    rate_name: row.rate_name,
    company_name: row.company_name,
    contact: row.contact,
    checklist: row.checklist || null,
    booked_by: row.booked_by,
    booked_at: row.booked_at,
```

- [ ] **Step 2: Pass `purpose` through pricing**

Update `priceAndStore` (line 212) to accept and forward `purpose`:

```js
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

- [ ] **Step 3: Capture purpose/company/contact/quote_number on create**

In `POST /trips`, read the new body fields and persist them on insert. Add the import at the top of the file:

```js
import { nextQuoteNumber } from '../scheduling/numbering.js';
```

Then in the handler, after reading `inputLegs`:

```js
    const purpose = (body.purpose || '').trim() || null;          // 'owner' | 'charter' | null
    const company_name = (body.company_name || '').trim() || null;
    const contact = body.contact && typeof body.contact === 'object' ? body.contact : null;
    const quote_number = await nextQuoteNumber();

    const status = 'quote';
    const { data: trip, error: e1 } = await supabase
      .from('scheduling_trips')
      .insert({ origin: 'native', status, trip_number, quote_number: String(quote_number), purpose, company_name, contact, modified_at: new Date().toISOString(), modified_by: req.user?.email || null })
      .select('id, ' + TRIP_COLS).single();
    if (e1) throw e1;
```

and update the pricing call near the end of create to pass purpose:

```js
    await priceAndStore(trip.id, aircraft_tail, inputLegs, purpose);
```

- [ ] **Step 4: Run the scheduling suite (guards against breaking the pure helpers)**

Run: `node --test backend/src/scheduling/*.test.js`
Expected: PASS.

- [ ] **Step 5: Manual verification**

```bash
curl -s -X POST "$API/api/scheduling/trips" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"aircraft_tail":"N69FP","purpose":"charter","company_name":"FlyBLACK","contact":{"name":"Jaime","email":"j@x.com","phone":"305"},"legs":[{"dep_icao":"KFXE","arr_icao":"KTEB","dep_time":"2026-07-01T12:00:00Z","pax":4}]}'
```

Expected: 201; the returned `trip` has `quote_number`, `purpose:"charter"`, `company_name:"FlyBLACK"`, `contact`, and `rate_name` is the charter card's name (if both cards exist).

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/scheduling.js
git commit -m "feat(scheduling): capture quote#, purpose, company/contact on create"
```

---

## Task 7: Book transition assigns Trip# + Booked-by

**Files:**
- Modify: `backend/src/routes/scheduling.js:328-357` (`PATCH /trips/:lfOid` status)

- [ ] **Step 1: Add the import**

```js
import { nextTripNumber } from '../scheduling/numbering.js';
```

- [ ] **Step 2: On the Book transition, stamp trip_number + booked_by/at**

In the status handler, after the `isValidTransition` check and before the `update`, build an `extra` patch:

```js
    const extra = {};
    if (status === 'booked') {
      extra.booked_by = req.user?.email || null;
      extra.booked_at = new Date().toISOString();
      // assign a Trip# once, only if it doesn't already have one
      const { data: cur2 } = await supabase
        .from('scheduling_trips').select('trip_number').eq(col, req.params.lfOid).single();
      if (!cur2?.trip_number) extra.trip_number = String(await nextTripNumber());
    }
    const { data, error } = await supabase
      .from('scheduling_trips')
      .update({ status, locally_modified: cur.origin === 'levelflight', modified_at: new Date().toISOString(), modified_by: req.user?.email || null, ...extra })
      .eq(col, req.params.lfOid)
      .select('id, ' + TRIP_COLS).single();
```

(The rest of the handler — `syncNativeLegStatus`, response — is unchanged.)

- [ ] **Step 3: Manual verification**

Book a native quote, then GET it:

```bash
curl -s -X PATCH "$API/api/scheduling/trips/$TRIP_ID" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{"status":"booked"}'
```

Expected: the returned `trip` now has a `trip_number` and `booked_by`/`booked_at`, while `quote_number` is unchanged.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/scheduling.js
git commit -m "feat(scheduling): Book assigns Trip# + booked-by stamp"
```

---

## Task 8: Trip Checklist persistence route

**Files:**
- Modify: `backend/src/routes/scheduling.js` (add a new route near the other `/trips/:lfOid/*` handlers, e.g. after the crew route ~line 528)

- [ ] **Step 1: Add the route**

```js
// PATCH /api/scheduling/trips/:lfOid/checklist — persist the dispatch checklist booleans.
router.patch('/trips/:lfOid/checklist', requireSchedulingEditor, async (req, res) => {
  try {
    const col = tripColumn(req.params.lfOid);
    const { data: trip, error } = await supabase
      .from('scheduling_trips').select('id, checklist').eq(col, req.params.lfOid).single();
    if (error) { if (isNotFound(error)) return res.status(404).json({ error: 'Trip not found' }); throw error; }
    const b = req.body || {};
    const bool = (k, prev) => (typeof b[k] === 'boolean' ? b[k] : !!prev);
    const prev = trip.checklist || {};
    const checklist = {
      contractReceived: bool('contractReceived', prev.contractReceived),
      paymentReceived: bool('paymentReceived', prev.paymentReceived),
      paymentProcessed: bool('paymentProcessed', prev.paymentProcessed),
    };
    await supabase.from('scheduling_trips').update({ checklist }).eq('id', trip.id);
    res.json({ checklist });
  } catch (e) {
    console.error('PATCH /api/scheduling/trips/:lfOid/checklist:', e.message);
    res.status(500).json({ error: 'Failed to save checklist' });
  }
});
```

- [ ] **Step 2: Manual verification**

```bash
curl -s -X PATCH "$API/api/scheduling/trips/$TRIP_ID/checklist" -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{"contractReceived":true}'
```

Expected: `{ "checklist": { "contractReceived": true, "paymentReceived": false, "paymentProcessed": false } }`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/scheduling.js
git commit -m "feat(scheduling): persist the trip checklist"
```

---

## Task 9: Rate-card CRUD UI — label + purpose

**Files:**
- Modify: `frontend/src/pages/RateCards.jsx:5-22` (FIELDS), and the card header (140-151)
- Modify: `backend/src/routes/rateCards.js:8` (ordering)

- [ ] **Step 1: Add `label` + `purpose` to the form fields**

In `FIELDS` (after `aircraft_type`, line 7), insert:

```js
  { key: 'label',   label: 'Rate Name',  type: 'text',   placeholder: 'N69FP CHARTER', note: 'Shown on the trip as the Rate' },
  { key: 'purpose', label: 'Purpose',    type: 'select', options: ['', 'owner', 'charter'], note: 'owner vs charter — selected automatically by the trip Purpose' },
```

- [ ] **Step 2: Render the `select` field type**

In the form `.map(f => …)` (line 202), replace the single `<input>` with a branch so `select` renders a dropdown:

```jsx
                  {f.type === 'select' ? (
                    <select
                      value={form[f.key] ?? ''}
                      onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                      style={{ width: '100%', padding: '8px 12px', fontSize: '13px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}>
                      {f.options.map(o => <option key={o} value={o}>{o === '' ? '— default —' : o}</option>)}
                    </select>
                  ) : (
                    <input
                      type={f.type}
                      value={form[f.key] ?? ''}
                      onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      step={f.key === 'fet_rate' ? '0.001' : '1'}
                      style={{ width: '100%', padding: '8px 12px', fontSize: '13px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
                    />
                  )}
```

- [ ] **Step 3: Show the label + purpose on each card header**

In the card header (line 144), show the rate name + a purpose chip:

```jsx
                  <span style={{ fontSize: '18px', fontWeight: '700', color: 'var(--accent)' }}>{card.label || card.aircraft_tail}</span>
                  {card.purpose && <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>{card.purpose}</span>}
                  {card.aircraft_type && <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{card.aircraft_type}</span>}
```

- [ ] **Step 4: Order the list by tail then purpose (backend)**

In `backend/src/routes/rateCards.js`, change the GET ordering (line 8):

```js
    const { data, error } = await supabase.from('rate_cards').select('*').order('aircraft_tail').order('purpose', { nullsFirst: true });
```

- [ ] **Step 5: Verify the frontend builds**

Run: `cd frontend && npm run build`
Expected: build succeeds (no syntax errors).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/RateCards.jsx backend/src/routes/rateCards.js
git commit -m "feat(rate-cards): label + purpose (owner vs charter), multiple per tail"
```

---

## Phase A Done — Definition of Done

- Migration `018` written and applied by the user.
- `node --test backend/src/scheduling/*.test.js` passes (numbering, pickRateCard, pricing).
- `cd frontend && npm run build` passes.
- Manually verified: create a charter quote (gets quote#, charter rate, FET on), edit Fees (add taxable fee, toggle FET off, override total), Book it (gets trip#, booked-by), toggle a checklist item.

## Next Plans (separate documents, to follow)

- **Phase B — FBO directory + native documents:** `services/fbos.js` + bulk import script (uses the verified `rest.levelflight.com/api/airport/fbo/{ICAO}` endpoint and the `airport_fbos` table from migration 018); `nativeTripVM.js` (quote/itinerary/trip-sheet builders → existing renderers); doc routes branch uuid→native via the existing `tripColumn`/`UUID_RE` pattern; native accept endpoint.
- **Phase C — Frontend:** refactor `SchedulingTripDetail.jsx` into the tabbed Trip Overview (Legs/Fees/Crew/Pax/Documents) with the Fees tab (ad-hoc rows, FET switch, override) wired to Task 5; update the `recomputeInputs` mirror to match Task 4; FBO pickers; functional checklist (Task 8); upgrade `SchedulingNewTrip.jsx` (Purpose, Company/Contact, dynamic fleet, live price).
