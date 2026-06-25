# Pricing Tab + Slide-Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scheduling **Fees** tab with a LevelFlight-style **Pricing** experience — a collapsible summary bar + a right-side slide-out drawer of editable Item/Price rows — rendered in our dark theme, shared by the booked Trip page and the Quote editor, with per-line dollar overrides ("pins") and a Recalculate reset.

**Architecture:** Extend the single pricing engine (`scheduling/pricing.js` + its frontend mirror `lib/feesMath.js`) to take `flightCost` as a precomputed input and apply a per-line `overrides` map; add a backend helper that recomputes per-leg flight cost when the nominal Cost/Hr (`costPerHr`) / Pos/Hr (`posRate`) change. Two presentational components (`PricingSummary`, `PricingSlideOut`) are driven by the `pricing` object + an `onPatch` callback; the host page recomputes live via `feesMath` and autosaves through `PATCH /price-lines`.

**Tech Stack:** Node ≥20 ESM + Express + Supabase; React 19 + Vite; `node:test`. **No migration** — the `pricing` jsonb is extended additively.

**Spec:** `docs/superpowers/specs/2026-06-25-pricing-slideout-design.md`

**Branch note:** This builds on `main`. The separate `fix/quote-empty-legs-flighttime` branch (commit `c5885a4`) touches `pricing`-adjacent files; merge it to `main` before or alongside this work to avoid divergence.

---

## File Structure

**Backend:**
- Modify: `backend/src/scheduling/pricing.js` — `recomputeFromInputs` gains `flightCost` input + `overrides` + `effectiveHourly`; `repriceFromBase` preserves `overrides`; `priceTrip` emits `costPerHr`/`posRate`; new `computeFlightCost(legs, rateCard, {costPerHr, posRate})`.
- Modify: `backend/src/scheduling/pricing.test.js` — tests for overrides, effectiveHourly, computeFlightCost, repriceFromBase-preserves-overrides.
- Modify: `backend/src/scheduling/priceQuote.js` — `priceQuoteLegs` passes through `costPerHr`/`posRate` (priceTrip now emits them; no logic change beyond that).
- Modify: `backend/src/routes/scheduling.js` — `PATCH /price-lines` persists `costPerHr`/`posRate`/`overrides` and recomputes per-leg flight cost when rates change; `POST /price` (Recalculate) already re-runs priceTrip — ensure it clears overrides.

**Frontend:**
- Modify: `frontend/src/lib/feesMath.js` — mirror the engine change exactly.
- Modify: `frontend/src/lib/feesMath.test.js` — overrides + effectiveHourly + lockstep fixture.
- Create: `frontend/src/components/pricing/PricingSummary.jsx` — collapsible summary bar.
- Create: `frontend/src/components/pricing/PricingSlideOut.jsx` — right drawer editor.
- Create: `frontend/src/components/pricing/pricingRows.js` — shared pure helpers (row labels, the `onPatch` field map) used by both components + tests.
- Create: `frontend/src/components/pricing/pricingRows.test.js`
- Modify: `frontend/src/pages/QuoteEditor.jsx` — replace the inline pricing panel with the shared components.
- Modify: `frontend/src/pages/SchedulingTripDetail.jsx` — rename the `fees` tab to **Pricing**; replace the inline Fees editor with the shared components.

**Docs:**
- Modify: `CLAUDE.md` — §7, §19, §20.

---

## PHASE 1 — ENGINE (backend, TDD)

### Task 1: Extend `recomputeFromInputs` (per-line overrides + flightCost input + effectiveHourly)

**Files:**
- Modify: `backend/src/scheduling/pricing.js`
- Test: `backend/src/scheduling/pricing.test.js`

- [ ] **Step 1: Write the failing tests.** Append to `backend/src/scheduling/pricing.test.js`:

```javascript
import { recomputeFromInputs as rfi } from './pricing.js';

const baseInputs = () => ({
  flightCost: 48010, hours: 4.72, surchargePerHr: 1800,
  faFee: 700, faCount: 10, crewFee: 200, crewCount: 10,
  landingFee: 500, landings: 2, segmentPerPax: 4.95, pax: 15,
  overnightCost: 13500, fetRate: 0.075, fees: [], fetEnabled: true, totalOverride: null,
});

test('recomputeFromInputs: uses flightCost input directly (not hourlyRate*hours)', () => {
  const r = rfi(baseInputs());
  assert.equal(r.flightCost, 48010);
  assert.equal(r.effectiveHourly, Math.round(48010 / 4.72));
});

test('recomputeFromInputs: a per-line override pins that line and flows into FET base', () => {
  const r = rfi({ ...baseInputs(), overrides: { surcharge: 9000 } });
  assert.equal(r.surcharge, 9000);                  // pinned, not surchargePerHr*hours
  assert.ok(r.fetBase >= 9000);                      // pinned value is in the base
});

test('recomputeFromInputs: flightCost override changes effectiveHourly', () => {
  const r = rfi({ ...baseInputs(), overrides: { flightCost: 60000 } });
  assert.equal(r.flightCost, 60000);
  assert.equal(r.effectiveHourly, Math.round(60000 / 4.72));
});

test('recomputeFromInputs: back-compat — no flightCost input falls back to hourlyRate*hours', () => {
  const r = rfi({ hourlyRate: 10000, hours: 5, fetRate: 0, fees: [] });
  assert.equal(r.flightCost, 50000);
});

test('recomputeFromInputs: totalOverride still wins over computed total', () => {
  const r = rfi({ ...baseInputs(), totalOverride: 99000 });
  assert.equal(r.total, 99000);
});
```

- [ ] **Step 2: Run to verify it fails.** `node --test backend/src/scheduling/pricing.test.js` — Expected: FAIL (effectiveHourly undefined; overrides ignored).

- [ ] **Step 3: Implement.** In `backend/src/scheduling/pricing.js`, replace the entire `recomputeFromInputs` export (currently lines 19–48) with:

```javascript
// Recompute the full breakdown from editable inputs + per-line $ overrides + ad-hoc Fees.
// `flightCost` (the per-leg computed value) is passed in; if absent we fall back to
// hourlyRate*hours (back-compat). `overrides` pins any line to a manual dollar amount.
// Taxable ad-hoc fees join the FET base; non-taxable fees are added after FET.
// `fetEnabled === false` disables FET. `totalOverride` (when set) wins over the total.
export const recomputeFromInputs = (i) => {
  const n = (v) => Number(v) || 0;
  const ov = (i.overrides && typeof i.overrides === 'object') ? i.overrides : {};
  const pinned = (k) => ov[k] !== undefined && ov[k] !== null && ov[k] !== '';
  const pin = (k, computed) => (pinned(k) ? Math.round(n(ov[k])) : computed);

  const baseFlight = (i.flightCost !== undefined && i.flightCost !== null && i.flightCost !== '')
    ? Math.round(n(i.flightCost)) : Math.round(n(i.hourlyRate) * n(i.hours));
  const flightCost = pin('flightCost', baseFlight);
  const surcharge = pin('surcharge', Math.round(n(i.surchargePerHr) * n(i.hours)));
  const faCost = pin('faCost', Math.round(n(i.faFee) * n(i.faCount)));
  const crewCost = pin('crewCost', Math.round(n(i.crewFee) * n(i.crewCount)));
  const landingCost = pin('landingCost', Math.round(n(i.landingFee) * n(i.landings)));
  const overnightComputed = (i.overnightRate !== undefined && i.overnightRate !== null)
    ? Math.round(Math.max(0, n(i.nights) - n(i.overnightThreshold)) * n(i.overnightRate))
    : Math.round(n(i.overnightCost));
  const overnightCost = pin('overnightCost', overnightComputed);
  const segmentFee = pin('segmentFee', Math.round(n(i.segmentPerPax) * n(i.pax)));

  const fees = Array.isArray(i.fees) ? i.fees : [];
  const feesTaxable = Math.round(fees.filter((f) => f.taxable).reduce((s, f) => s + n(f.amount), 0));
  const feesNonTaxable = Math.round(fees.filter((f) => !f.taxable).reduce((s, f) => s + n(f.amount), 0));

  const fetBase = flightCost + surcharge + landingCost + faCost + crewCost + overnightCost + feesTaxable;
  const fetEnabled = i.fetEnabled !== false;
  const fetAmount = fetEnabled ? Math.round(fetBase * n(i.fetRate)) : 0;
  const computedTotal = Math.round(fetBase + segmentFee + fetAmount + feesNonTaxable);

  const hasOverride = i.totalOverride !== null && i.totalOverride !== undefined && i.totalOverride !== '';
  const totalOverride = hasOverride ? Math.round(n(i.totalOverride)) : null;

  const hours = n(i.hours);
  const effectiveHourly = hours > 0 ? Math.round(flightCost / hours) : 0;

  return {
    flightCost, surcharge, faCost, crewCost, landingCost, overnightCost, segmentFee,
    fees, feesTaxable, feesNonTaxable,
    fetEnabled, fetBase: Math.round(fetBase), fetAmount,
    computedTotal, totalOverride, effectiveHourly,
    total: hasOverride ? totalOverride : computedTotal,
  };
};
```

- [ ] **Step 4: Run to verify it passes.** `node --test backend/src/scheduling/pricing.test.js` — Expected: PASS (existing + new).

- [ ] **Step 5: Commit.**
```bash
git add backend/src/scheduling/pricing.js backend/src/scheduling/pricing.test.js
git commit -m "feat(pricing): recomputeFromInputs takes flightCost + per-line overrides + effectiveHourly"
```

---

### Task 2: `repriceFromBase` preserves overrides; `priceTrip` emits `costPerHr`/`posRate`

**Files:**
- Modify: `backend/src/scheduling/pricing.js`
- Test: `backend/src/scheduling/pricing.test.js`

- [ ] **Step 1: Write the failing tests.** Append to `pricing.test.js`:

```javascript
import { repriceFromBase as rfb, priceTrip as pt } from './pricing.js';

const card = { aircraft_tail: 'N69FP', label: 'N69FP CHARTER', hourly_rate: 8500, positioning_rate: 7000,
  surcharge_per_hr: 1800, landing_fee: 500, fa_fee: 700, crew_fee: 200, overnight_fee: 1500,
  overnight_threshold: 0, segment_fee_per_pax: 4.95, fet_rate: 0.075 };

test('priceTrip emits nominal costPerHr and posRate from the rate card', () => {
  const r = pt({ legs: [{ from: 'KFXE', to: 'KTEB', mins: 130, pax: 4, isPositioning: false }], rateCard: card });
  assert.equal(r.costPerHr, 8500);
  assert.equal(r.posRate, 7000);
});

test('repriceFromBase preserves per-line overrides across a leg reprice', () => {
  const fresh = pt({ legs: [{ from: 'KFXE', to: 'KTEB', mins: 130, pax: 4, isPositioning: false }], rateCard: card });
  const out = rfb(fresh, { overrides: { surcharge: 9999 } });
  assert.equal(out.surcharge, 9999);
  assert.deepEqual(out.overrides, { surcharge: 9999 });
  assert.equal(out.manual, true);
});
```

- [ ] **Step 2: Run to verify it fails.** `node --test backend/src/scheduling/pricing.test.js` — Expected: FAIL (costPerHr undefined; overrides not preserved).

- [ ] **Step 3: Implement.** Two edits in `pricing.js`:

(a) In `priceTrip`'s returned object, add `costPerHr` and `posRate`. Change the return block's `fetBase` line region — specifically add these two properties next to `hourlyRate` (after the line `hourlyRate: totalHrs > 0 ? Math.round(flightCost / totalHrs) : (rateCard.hourly_rate || 0),`):

```javascript
    costPerHr: rateCard.hourly_rate || 0,
    posRate: rateCard.positioning_rate || 0,
```

(b) Replace the entire `repriceFromBase` export with (adds `overrides` to the manual check, the preserved inputs, and the `flightCost` passthrough):

```javascript
// After a rate-card reprice (leg/aircraft/purpose change), keep the user's manual
// per-line $ overrides, ad-hoc fees, FET on/off, and total override; recompute so the
// override still wins. Returns the fresh base untouched when there were no manual edits.
export const repriceFromBase = (fresh, old = {}) => {
  const o = old && !old.error ? old : {};
  const ov = (o.overrides && typeof o.overrides === 'object') ? o.overrides : {};
  const hasManual = Object.keys(ov).length > 0
    || (Array.isArray(o.fees) && o.fees.length > 0)
    || (o.totalOverride !== null && o.totalOverride !== undefined && o.totalOverride !== '')
    || o.fetEnabled === false;
  if (!hasManual) return fresh;
  const inputs = {
    flightCost: fresh.flightCost,
    hourlyRate: fresh.hourlyRate, hours: fresh.hours, surchargePerHr: fresh.surchargePerHr,
    faFee: fresh.faFee, faCount: fresh.faCount, crewFee: fresh.crewFee, crewCount: fresh.crewCount,
    landingFee: fresh.landingFee, landings: fresh.landings,
    segmentPerPax: fresh.segmentPerPax, pax: fresh.pax, overnightCost: fresh.overnightCost,
    fetRate: fresh.fetRate,
    fees: Array.isArray(o.fees) ? o.fees : [],
    fetEnabled: o.fetEnabled !== false,
    totalOverride: o.totalOverride ?? null,
    overrides: ov,
  };
  return { ...fresh, ...inputs, ...recomputeFromInputs(inputs), overrides: ov, manual: true };
};
```

- [ ] **Step 4: Run to verify it passes.** `node --test backend/src/scheduling/pricing.test.js` — Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add backend/src/scheduling/pricing.js backend/src/scheduling/pricing.test.js
git commit -m "feat(pricing): priceTrip emits costPerHr/posRate; repriceFromBase preserves overrides"
```

---

### Task 3: `computeFlightCost` helper (per-leg flight cost with overridden rates)

**Files:**
- Modify: `backend/src/scheduling/pricing.js`
- Test: `backend/src/scheduling/pricing.test.js`

- [ ] **Step 1: Write the failing tests.** Append to `pricing.test.js`:

```javascript
import { computeFlightCost as cfc } from './pricing.js';

const card2 = { hourly_rate: 8500, positioning_rate: 7000, min_hours: 0, short_leg_time: 0 };

test('computeFlightCost: revenue legs at costPerHr, ferry legs at posRate', () => {
  const legs = [{ mins: 120, isPositioning: false }, { mins: 60, isPositioning: true }];
  // 2h*8500 + 1h*7000 = 24000
  assert.equal(cfc(legs, card2, {}).flightCost, 24000);
});

test('computeFlightCost: applies overridden costPerHr/posRate', () => {
  const legs = [{ mins: 120, isPositioning: false }, { mins: 60, isPositioning: true }];
  // 2h*9000 + 1h*6000 = 24000? -> 18000+6000=24000; change to verify override flows
  assert.equal(cfc(legs, card2, { costPerHr: 10000, posRate: 5000 }).flightCost, 25000); // 2*10000 + 1*5000
});

test('computeFlightCost: returns total flight hours', () => {
  const legs = [{ mins: 120, isPositioning: false }, { mins: 60, isPositioning: true }];
  assert.equal(cfc(legs, card2, {}).hours, 3);
});
```

- [ ] **Step 2: Run to verify it fails.** `node --test backend/src/scheduling/pricing.test.js` — Expected: FAIL (computeFlightCost not exported).

- [ ] **Step 3: Implement.** Append to `pricing.js`:

```javascript
// Per-leg flight cost honoring nominal Cost/Hr (revenue legs) and Pos/Hr (ferry legs),
// with the rate card's min_hours / short_leg flooring. `rates` optionally overrides the
// card's hourly_rate / positioning_rate (when the user edits Cost/Hr or Pos/Hr).
// legs: [{ mins, isPositioning }]. Returns { flightCost, hours }.
export const computeFlightCost = (legs = [], rateCard = {}, rates = {}) => {
  const card = {
    ...rateCard,
    hourly_rate: rates.costPerHr != null && rates.costPerHr !== '' ? Number(rates.costPerHr) : rateCard.hourly_rate,
    positioning_rate: rates.posRate != null && rates.posRate !== '' ? Number(rates.posRate) : rateCard.positioning_rate,
  };
  const perLeg = legs.map((l) => calcLeg(l.mins, card, { isPositioning: !!l.isPositioning }));
  const flightCost = Math.round(perLeg.reduce((s, l) => s + l.cost, 0));
  const hours = Math.round(perLeg.reduce((s, l) => s + l.hrs, 0) * 100) / 100;
  return { flightCost, hours };
};
```

- [ ] **Step 4: Run to verify it passes.** `node --test backend/src/scheduling/pricing.test.js` — Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add backend/src/scheduling/pricing.js backend/src/scheduling/pricing.test.js
git commit -m "feat(pricing): computeFlightCost per-leg with overridable Cost/Hr + Pos/Hr"
```

---

## PHASE 2 — BACKEND WIRING

### Task 4: `/price-lines` persists costPerHr/posRate/overrides + recomputes flight cost; `/price` clears overrides

**Files:**
- Modify: `backend/src/routes/scheduling.js`

- [ ] **Step 1: Import `computeFlightCost`.** The pricing import (line 17) currently reads:
```javascript
import { recomputeFromInputs, repriceFromBase } from '../scheduling/pricing.js';
```
Replace with:
```javascript
import { recomputeFromInputs, repriceFromBase, computeFlightCost } from '../scheduling/pricing.js';
```

- [ ] **Step 2: Extend `PATCH /trips/:lfOid/price-lines`.** Read the current handler (search for `price-lines`). Replace the body from `const base = trip.pricing && !trip.pricing.error ? trip.pricing : {};` through the `const pricing = { ...base, ...inputs, ...recomputeFromInputs(inputs), manual: true };` line and the update, with:

```javascript
    const base = trip.pricing && !trip.pricing.error ? trip.pricing : {};
    const b = req.body || {};
    const pick = (k) => (b[k] === undefined || b[k] === null || b[k] === '' ? (Number(base[k]) || 0) : Number(b[k]) || 0);

    // Recompute the per-leg flight cost when Cost/Hr or Pos/Hr changed (and the flight
    // line isn't pinned); otherwise keep the stored flightCost.
    const overrides = (b.overrides && typeof b.overrides === 'object') ? b.overrides : (base.overrides || {});
    const costPerHr = b.costPerHr === undefined ? (Number(base.costPerHr) || 0) : Number(b.costPerHr) || 0;
    const posRate = b.posRate === undefined ? (Number(base.posRate) || 0) : Number(b.posRate) || 0;
    let flightCost = Number(base.flightCost) || 0;
    let hours = Number(base.hours) || 0;
    const flightPinned = overrides.flightCost !== undefined && overrides.flightCost !== null && overrides.flightCost !== '';
    const ratesChanged = (b.costPerHr !== undefined && Number(b.costPerHr) !== (Number(base.costPerHr) || 0))
      || (b.posRate !== undefined && Number(b.posRate) !== (Number(base.posRate) || 0));
    if (ratesChanged && !flightPinned) {
      const { data: legRows } = await supabase
        .from('scheduling_legs').select('dep_icao, arr_icao, lf_synced_snapshot').eq('trip_id', trip.id).order('seq');
      const legInputs = (legRows || []).map((l) => ({ dep_icao: l.dep_icao, arr_icao: l.arr_icao, isPositioning: !!l.lf_synced_snapshot?.isPositioning }));
      const times = await legMinutes(null, legInputs);
      const { data: cards } = await supabase.from('rate_cards').select('*').eq('aircraft_tail', base.tail || legRows?.[0]?.lf_synced_snapshot?.dispatch?.aircraft?.tailNumber);
      const rateCard = (cards || [])[0] || {};
      const legs = legInputs.map((l, idx) => ({ mins: times[idx].minutes, isPositioning: l.isPositioning }));
      const fc = computeFlightCost(legs, rateCard, { costPerHr, posRate });
      flightCost = fc.flightCost; hours = fc.hours || hours;
    }

    const inputs = {
      flightCost, hours, costPerHr, posRate,
      surchargePerHr: pick('surchargePerHr'),
      faFee: pick('faFee'), faCount: pick('faCount'), crewFee: pick('crewFee'), crewCount: pick('crewCount'),
      landingFee: pick('landingFee'), landings: pick('landings'),
      segmentPerPax: pick('segmentPerPax'), pax: pick('pax'),
      nights: pick('nights'), overnightRate: Number(base.overnightRate) || 0, overnightThreshold: Number(base.overnightThreshold) || 0,
      overnightCost: pick('overnightCost'),
      fetRate: base.fetRate || 0,
      fees: Array.isArray(b.fees) ? b.fees : (base.fees || []),
      fetEnabled: b.fetEnabled === undefined ? (base.fetEnabled !== false) : !!b.fetEnabled,
      totalOverride: b.totalOverride === undefined ? (base.totalOverride ?? null) : b.totalOverride,
      overrides,
    };
    const pricing = { ...base, ...inputs, ...recomputeFromInputs(inputs), overrides, costPerHr, posRate, manual: true };
    await supabase.from('scheduling_trips').update({ pricing }).eq('id', trip.id);
    res.json({ pricing });
```

(Keep the handler's existing preflight `select('id, pricing')` — but it needs `tail` too. If the preflight select doesn't already include enough, the `base.tail` is read from the stored pricing which `priceTrip` emits, so no select change is required.)

- [ ] **Step 3: Ensure `POST /trips/:lfOid/price` (Recalculate) clears overrides.** Read the `/price` handler. After it computes `pricing = await priceQuoteLegs(...)`, the result is a fresh `priceTrip` breakdown with no `overrides`/`totalOverride` — which is exactly the Recalculate reset. Confirm the stored object does NOT carry forward old overrides: the handler does `update({ pricing, rate_name })` with the fresh object, so overrides are dropped. No code change needed beyond confirming it overwrites (not merges). If it merges with the old pricing, change it to store the fresh object only.

- [ ] **Step 4: Verify.** `node --check backend/src/routes/scheduling.js` (Expected: no output). `node --test backend/src/scheduling/pricing.test.js` (Expected: PASS).

- [ ] **Step 5: Commit.**
```bash
git add backend/src/routes/scheduling.js
git commit -m "feat(scheduling): /price-lines persists costPerHr/posRate/overrides + recomputes flight cost"
```

---

## PHASE 3 — FRONTEND ENGINE MIRROR + SHARED HELPERS

### Task 5: Mirror the engine change in `feesMath.js`

**Files:**
- Modify: `frontend/src/lib/feesMath.js`
- Test: `frontend/src/lib/feesMath.test.js`

- [ ] **Step 1: Write the failing tests.** Create or append to `frontend/src/lib/feesMath.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recomputeInputs } from './feesMath.js';

const base = () => ({ flightCost: 48010, hours: 4.72, surchargePerHr: 1800, faFee: 700, faCount: 10,
  crewFee: 200, crewCount: 10, landingFee: 500, landings: 2, segmentPerPax: 4.95, pax: 15,
  overnightCost: 13500, fetRate: 0.075, fees: [], fetEnabled: true, totalOverride: null });

test('recomputeInputs: flightCost input + effectiveHourly', () => {
  const r = recomputeInputs(base());
  assert.equal(r.flightCost, 48010);
  assert.equal(r.effectiveHourly, Math.round(48010 / 4.72));
});

test('recomputeInputs: per-line override pins the line', () => {
  const r = recomputeInputs({ ...base(), overrides: { surcharge: 9000 } });
  assert.equal(r.surcharge, 9000);
});

test('recomputeInputs: matches backend recomputeFromInputs for the same inputs', async () => {
  const { recomputeFromInputs } = await import('../../../backend/src/scheduling/pricing.js');
  const inputs = { ...base(), overrides: { faCost: 6000 }, totalOverride: null };
  assert.deepEqual(recomputeInputs(inputs), recomputeFromInputs(inputs));
});
```

- [ ] **Step 2: Run to verify it fails.** `node --test frontend/src/lib/feesMath.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement.** Replace the entire `recomputeInputs` export in `frontend/src/lib/feesMath.js` with a body **identical** to the backend `recomputeFromInputs` from Task 1 Step 3 (same formulas, same return), renamed to `recomputeInputs`:

```javascript
export const recomputeInputs = (i) => {
  const n = (v) => Number(v) || 0;
  const ov = (i.overrides && typeof i.overrides === 'object') ? i.overrides : {};
  const pinned = (k) => ov[k] !== undefined && ov[k] !== null && ov[k] !== '';
  const pin = (k, computed) => (pinned(k) ? Math.round(n(ov[k])) : computed);

  const baseFlight = (i.flightCost !== undefined && i.flightCost !== null && i.flightCost !== '')
    ? Math.round(n(i.flightCost)) : Math.round(n(i.hourlyRate) * n(i.hours));
  const flightCost = pin('flightCost', baseFlight);
  const surcharge = pin('surcharge', Math.round(n(i.surchargePerHr) * n(i.hours)));
  const faCost = pin('faCost', Math.round(n(i.faFee) * n(i.faCount)));
  const crewCost = pin('crewCost', Math.round(n(i.crewFee) * n(i.crewCount)));
  const landingCost = pin('landingCost', Math.round(n(i.landingFee) * n(i.landings)));
  const overnightComputed = (i.overnightRate !== undefined && i.overnightRate !== null)
    ? Math.round(Math.max(0, n(i.nights) - n(i.overnightThreshold)) * n(i.overnightRate))
    : Math.round(n(i.overnightCost));
  const overnightCost = pin('overnightCost', overnightComputed);
  const segmentFee = pin('segmentFee', Math.round(n(i.segmentPerPax) * n(i.pax)));

  const fees = Array.isArray(i.fees) ? i.fees : [];
  const feesTaxable = Math.round(fees.filter((f) => f.taxable).reduce((s, f) => s + n(f.amount), 0));
  const feesNonTaxable = Math.round(fees.filter((f) => !f.taxable).reduce((s, f) => s + n(f.amount), 0));

  const fetBase = flightCost + surcharge + landingCost + faCost + crewCost + overnightCost + feesTaxable;
  const fetEnabled = i.fetEnabled !== false;
  const fetAmount = fetEnabled ? Math.round(fetBase * n(i.fetRate)) : 0;
  const computedTotal = Math.round(fetBase + segmentFee + fetAmount + feesNonTaxable);

  const hasOverride = i.totalOverride !== null && i.totalOverride !== undefined && i.totalOverride !== '';
  const totalOverride = hasOverride ? Math.round(n(i.totalOverride)) : null;

  const hours = n(i.hours);
  const effectiveHourly = hours > 0 ? Math.round(flightCost / hours) : 0;

  return {
    flightCost, surcharge, faCost, crewCost, landingCost, overnightCost, segmentFee,
    fees, feesTaxable, feesNonTaxable,
    fetEnabled, fetBase: Math.round(fetBase), fetAmount,
    computedTotal, totalOverride, effectiveHourly,
    total: hasOverride ? totalOverride : computedTotal,
  };
};
```

- [ ] **Step 4: Run to verify it passes.** `node --test frontend/src/lib/feesMath.test.js` — Expected: PASS (incl. the lockstep test).

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/lib/feesMath.js frontend/src/lib/feesMath.test.js
git commit -m "feat(feesMath): mirror flightCost input + per-line overrides + effectiveHourly"
```

---

### Task 6: Shared row helpers `pricingRows.js`

**Files:**
- Create: `frontend/src/components/pricing/pricingRows.js`
- Test: `frontend/src/components/pricing/pricingRows.test.js`

- [ ] **Step 1: Write the failing test.** Create `frontend/src/components/pricing/pricingRows.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtHrs, pinPatch, unpinPatch } from './pricingRows.js';

test('fmtHrs: minutes-as-hours to H:MM', () => {
  assert.equal(fmtHrs(4.7166), '4:43');
  assert.equal(fmtHrs(0), '0:00');
});

test('pinPatch: sets an override for a line', () => {
  assert.deepEqual(pinPatch({ a: 1 }, 'surcharge', 9000), { overrides: { a: 1, surcharge: 9000 } });
});

test('unpinPatch: removes an override for a line', () => {
  assert.deepEqual(unpinPatch({ a: 1, surcharge: 9000 }, 'surcharge'), { overrides: { a: 1 } });
});
```

- [ ] **Step 2: Run to verify it fails.** `node --test frontend/src/components/pricing/pricingRows.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement.** Create `frontend/src/components/pricing/pricingRows.js`:

```javascript
// Pure helpers shared by PricingSummary + PricingSlideOut.

// Decimal hours -> "H:MM".
export const fmtHrs = (hrs) => {
  const m = Math.round((Number(hrs) || 0) * 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};

// Build an onPatch payload that pins a line to a manual dollar amount.
export const pinPatch = (overrides, line, value) => ({
  overrides: { ...(overrides || {}), [line]: Number(value) || 0 },
});

// Build an onPatch payload that removes a line's pin.
export const unpinPatch = (overrides, line) => {
  const next = { ...(overrides || {}) };
  delete next[line];
  return { overrides: next };
};

export const usd = (nv) => (nv == null ? '—' : '$' + Number(nv).toLocaleString('en-US'));
```

- [ ] **Step 4: Run to verify it passes.** `node --test frontend/src/components/pricing/pricingRows.test.js` — Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/components/pricing/pricingRows.js frontend/src/components/pricing/pricingRows.test.js
git commit -m "feat(pricing): shared pricingRows helpers (fmtHrs, pin/unpin patches)"
```

---

## PHASE 4 — COMPONENTS

### Task 7: `PricingSummary.jsx` (collapsible bar)

**Files:**
- Create: `frontend/src/components/pricing/PricingSummary.jsx`

- [ ] **Step 1: Create the component.** Create `frontend/src/components/pricing/PricingSummary.jsx`:

```jsx
import { recomputeInputs } from '../../lib/feesMath';
import { fmtHrs, usd } from './pricingRows';

// Collapsible Pricing summary bar (the "tab"). Presentational: shows the live
// breakdown from `pricing` and exposes Open / FET / Total-override handlers.
// props: { pricing, collapsed, onToggle, onOpen, editable }
export default function PricingSummary({ pricing, collapsed = false, onToggle, onOpen, editable = true }) {
  if (!pricing || pricing.error) {
    return (
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Pricing</span>
          {editable && <button style={editBtn} onClick={onOpen}>✎ Edit pricing</button>}
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '10px 0 0' }}>{pricing?.error || 'No pricing yet.'}</p>
      </div>
    );
  }
  const live = recomputeInputs(pricing);
  const metric = (lbl, val, sub) => (
    <div style={metricStyle}>
      <div style={lblStyle}>{lbl}</div>
      <div style={valStyle}>{usd(val)}</div>
      {sub}
    </div>
  );
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={onToggle}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Pricing</span>
        <span style={{ display: 'flex', gap: 14, alignItems: 'center', color: 'var(--text-secondary)', fontSize: 12 }}>
          {editable && <span style={editLink} onClick={(e) => { e.stopPropagation(); onOpen(); }}>✎ Edit pricing</span>}
          <span>{collapsed ? '▸' : '▾'}</span>
        </span>
      </div>
      {!collapsed && (
        <div style={{ display: 'flex', gap: 0, alignItems: 'stretch', marginTop: 14, flexWrap: 'wrap' }}>
          {metric('Effective Cost/Hr', live.effectiveHourly)}
          {metric(`Flight Time (${fmtHrs(pricing.hours)})`, live.flightCost)}
          {metric('Surcharge', live.surcharge)}
          {metric('Landings', live.landingCost)}
          {metric(`RON (${pricing.nights || 0})`, live.overnightCost)}
          {metric(`FA (${pricing.faCount || 0})`, live.faCost)}
          {metric(`Crew (${pricing.crewCount || 0})`, live.crewCost)}
          {metric('Segment', live.segmentFee)}
          <div style={totalCard}>
            <div style={{ fontSize: 11, letterSpacing: '.08em', color: 'var(--text-secondary)' }}>TOTAL PRICE</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' }}>
              {usd(live.total)}{pricing.totalOverride != null ? ' ·' : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 };
const metricStyle = { flex: '1 1 110px', minWidth: 104, padding: '2px 14px', borderRight: '1px solid var(--border)' };
const lblStyle = { fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, whiteSpace: 'nowrap' };
const valStyle = { fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' };
const totalCard = { flex: '0 0 200px', background: 'var(--bg-secondary)', border: '1px solid var(--accent)', borderRadius: 10, padding: '12px 16px', textAlign: 'right', marginLeft: 8, display: 'flex', flexDirection: 'column', justifyContent: 'center' };
const editBtn = { padding: '6px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' };
const editLink = { color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' };
```

- [ ] **Step 2: Build check (after Task 9 wires it).** Not imported yet; compiled in Task 9.

- [ ] **Step 3: Commit.**
```bash
git add frontend/src/components/pricing/PricingSummary.jsx
git commit -m "feat(pricing): PricingSummary collapsible bar component"
```

---

### Task 8: `PricingSlideOut.jsx` (right drawer editor)

**Files:**
- Create: `frontend/src/components/pricing/PricingSlideOut.jsx`

- [ ] **Step 1: Create the component.** Create `frontend/src/components/pricing/PricingSlideOut.jsx`:

```jsx
import { recomputeInputs } from '../../lib/feesMath';
import { fmtHrs, usd, pinPatch, unpinPatch } from './pricingRows';
import { FEE_CODES } from '../../lib/feeCatalog';

// Right-side drawer for editing pricing, LevelFlight-style. Presentational +
// controlled: shows live values from `pricing`, emits edits via onPatch(patch)
// and onRecalculate() / onClose(). A $ edit pins the line (overrides); a rate/count
// edit sets the input. props: { pricing, onPatch, onRecalculate, onClose }
export default function PricingSlideOut({ pricing, onPatch, onRecalculate, onClose }) {
  if (!pricing) return null;
  const live = recomputeInputs(pricing);
  const ov = pricing.overrides || {};
  const pinned = (k) => ov[k] !== undefined && ov[k] !== null && ov[k] !== '';

  // $ line — editable amount that pins the line; shows a reset control when pinned.
  const dollarRow = (label, line, value) => (
    <div style={{ ...row, ...(pinned(line) ? rowPinned : null) }} key={line}>
      <span style={rl}>{label}{pinned(line) && <span title="Pinned" style={dot}>●</span>}</span>
      <span style={rv}>
        <input type="number" value={value} style={numInp}
          onChange={(e) => onPatch(pinPatch(ov, line, e.target.value))} />
        {pinned(line) && <button title="Reset to calculated" style={resetBtn} onClick={() => onPatch(unpinPatch(ov, line))}>↺</button>}
      </span>
    </div>
  );
  // rate/count input — sets a plain input field (recomputes its line unless pinned).
  const inputRow = (label, field, value) => (
    <div style={row} key={field}>
      <span style={rl}>{label}</span>
      <span style={rv}><input type="number" value={value ?? ''} style={numInp}
        onChange={(e) => onPatch({ [field]: e.target.value })} /></span>
    </div>
  );
  const roRow = (label, val, opts = {}) => (
    <div style={{ ...row, ...(opts.subtotal ? rowSub : null) }} key={label}>
      <span style={{ ...rl, ...(opts.subtotal ? { fontWeight: 800, color: '#fff' } : null) }}>{label}</span>
      <span style={{ ...rv, color: opts.accent ? 'var(--accent)' : (opts.subtotal ? '#fff' : 'var(--text-secondary)') }}>{val}</span>
    </div>
  );

  return (
    <div style={overlay} onClick={onClose}>
      <div style={drawer} onClick={(e) => e.stopPropagation()}>
        <div style={head}>
          <button style={recalc} onClick={onRecalculate}>↻ Recalculate</button>
          <span style={{ fontSize: 16, fontWeight: 700, flex: 1, color: 'var(--text-primary)' }}>Pricing</span>
          <span style={{ color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 16 }} onClick={onClose}>✕</span>
        </div>
        <div style={{ overflow: 'auto', padding: '10px 12px' }}>
          <div style={colHead}><span>Item</span><span>Price</span></div>
          {inputRow('Cost / Hr', 'costPerHr', pricing.costPerHr)}
          {inputRow('Pos / Hr', 'posRate', pricing.posRate)}
          {roRow('Flight Time', fmtHrs(pricing.hours))}
          {dollarRow('Flight Time Cost', 'flightCost', pricing.overrides?.flightCost ?? live.flightCost)}
          {roRow('Flight Base Cost', usd(live.flightCost), { subtotal: true })}
          {roRow('Effective Hourly', usd(live.effectiveHourly), { accent: true })}

          <div style={sectionLbl}>Additional</div>
          {dollarRow('Fuel Surcharge', 'surcharge', pricing.overrides?.surcharge ?? live.surcharge)}
          {dollarRow('Landings', 'landingCost', pricing.overrides?.landingCost ?? live.landingCost)}
          {inputRow('RON Days', 'nights', pricing.nights)}
          {dollarRow('RON Cost', 'overnightCost', pricing.overrides?.overnightCost ?? live.overnightCost)}
          {inputRow('FA Days', 'faCount', pricing.faCount)}
          {dollarRow('FA Cost', 'faCost', pricing.overrides?.faCost ?? live.faCost)}
          {inputRow('Crew Days', 'crewCount', pricing.crewCount)}
          {dollarRow('Crew Cost', 'crewCost', pricing.overrides?.crewCost ?? live.crewCost)}
          {dollarRow('Segment', 'segmentFee', pricing.overrides?.segmentFee ?? live.segmentFee)}

          <div style={row}>
            <span style={rl}><input type="checkbox" checked={pricing.fetEnabled !== false}
              onChange={(e) => onPatch({ fetEnabled: e.target.checked })} /> FET ({Math.round((pricing.fetRate || 0) * 1000) / 10}%)</span>
            <span style={{ ...rv, color: 'var(--text-secondary)' }}>{usd(live.fetAmount)}</span>
          </div>

          {(pricing.fees || []).map((f, idx) => (
            <div style={row} key={`fee${idx}`}>
              <span style={rl}>
                <select value={f.code || ''} style={selInp}
                  onChange={(e) => onPatch({ fees: pricing.fees.map((x, i) => (i === idx ? { ...x, code: e.target.value } : x)) })}>
                  {FEE_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <label style={{ fontSize: 11, marginLeft: 6 }}><input type="checkbox" checked={!!f.taxable}
                  onChange={(e) => onPatch({ fees: pricing.fees.map((x, i) => (i === idx ? { ...x, taxable: e.target.checked } : x)) })} /> tax</label>
              </span>
              <span style={rv}><input type="number" value={f.amount} style={numInp}
                onChange={(e) => onPatch({ fees: pricing.fees.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)) })} /></span>
            </div>
          ))}
          <div style={row}>
            <button style={addFee} onClick={() => onPatch({ fees: [...(pricing.fees || []), { code: FEE_CODES[0], description: '', amount: 0, taxable: true }] })}>+ Add fee</button>
          </div>

          <div style={{ ...row, ...rowTotal }}>
            <span style={{ ...rl, fontWeight: 800 }}>Total Price</span>
            <span style={rv}>
              <input type="number" value={pricing.totalOverride ?? ''} placeholder={String(live.computedTotal)} style={{ ...numInp, fontWeight: 800, width: 100 }}
                onChange={(e) => onPatch({ totalOverride: e.target.value === '' ? null : e.target.value })} />
              {pricing.totalOverride != null && <button style={resetBtn} title="Clear override" onClick={() => onPatch({ totalOverride: null })}>↺</button>}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' };
const drawer = { width: 400, maxWidth: '92vw', background: 'var(--bg-card)', borderLeft: '1px solid var(--border)', boxShadow: '-12px 0 28px rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column' };
const head = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' };
const recalc = { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' };
const colHead = { display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 11, letterSpacing: '.06em', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 8 };
const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 9, marginBottom: 7, background: 'var(--bg-secondary)' };
const rowPinned = { borderColor: 'var(--accent)' };
const rowSub = { background: '#23232e', borderColor: '#33333f' };
const rowTotal = { border: '1px solid var(--accent)' };
const rl = { fontSize: 13, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 };
const rv = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' };
const numInp = { width: 90, textAlign: 'right', padding: '5px 8px', fontSize: 13, background: '#0d0d12', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6 };
const selInp = { padding: '4px 6px', fontSize: 12, background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6 };
const sectionLbl = { fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-secondary)', margin: '16px 0 8px' };
const dot = { color: 'var(--accent)', fontSize: 9 };
const resetBtn = { padding: '2px 7px', fontSize: 12, background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' };
const addFee = { padding: '4px 12px', fontSize: 12, background: 'var(--bg-card)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' };
```

- [ ] **Step 2: Build check** happens in Task 9.

- [ ] **Step 3: Commit.**
```bash
git add frontend/src/components/pricing/PricingSlideOut.jsx
git commit -m "feat(pricing): PricingSlideOut drawer editor component"
```

---

## PHASE 5 — WIRING

### Task 9: Wire the shared components into the Quote editor

**Files:**
- Modify: `frontend/src/pages/QuoteEditor.jsx`

- [ ] **Step 1: Add imports + state.** At the top of `QuoteEditor.jsx`, add:
```jsx
import PricingSummary from '../components/pricing/PricingSummary';
import PricingSlideOut from '../components/pricing/PricingSlideOut';
```
Add state near the other `useState`s: `const [pricingOpen, setPricingOpen] = useState(false);` and `const [pricingCollapsed, setPricingCollapsed] = useState(false);`

- [ ] **Step 2: Add the patch + recalculate handlers.** Add inside the component (after the existing fee/override handlers):
```jsx
  // Merge a pricing patch into local pricing, recompute live, and autosave via /price-lines.
  const patchPricing = (patch) => {
    setPricing((p) => {
      const merged = { ...(p || {}), ...patch };
      if (patch.overrides) merged.overrides = patch.overrides;
      return { ...merged, ...recomputeInputs(merged) };
    });
  };
  const recalcPricing = async () => {
    try {
      const r = await apiFetch(`/api/scheduling/trips/${tripId}/price`, { method: 'POST', body: JSON.stringify({}) });
      const j = await r.json();
      if (r.ok && j.pricing) setPricing(j.pricing && !j.pricing.error ? j.pricing : null);
    } catch (e) { setError(e.message); }
  };
```
(`recomputeInputs` is already imported in QuoteEditor.) Ensure the existing price-lines autosave effect (which watches `fees/fetEnabled/totalOverride`) is broadened to also watch `pricing.overrides`, `pricing.costPerHr`, `pricing.posRate`, `pricing.surchargePerHr`, `pricing.landingFee`/`landings`, `pricing.nights`, `pricing.faCount`, `pricing.crewCount`, `pricing.segmentPerPax` — i.e. key the price autosave on `JSON.stringify({ overrides: pricing?.overrides, costPerHr: pricing?.costPerHr, posRate: pricing?.posRate, nights: pricing?.nights, faCount: pricing?.faCount, crewCount: pricing?.crewCount, fees, fetEnabled, totalOverride })` and PATCH the full `{ ...those fields }`.

- [ ] **Step 3: Replace the inline pricing panel JSX.** Find the existing compact pricing `<div style={card}> … </div>` block in QuoteEditor's render (the one titled "Pricing — …" with the fees table) and replace the whole block with:
```jsx
        <PricingSummary pricing={pricing} collapsed={pricingCollapsed} onToggle={() => setPricingCollapsed((c) => !c)} onOpen={() => setPricingOpen(true)} editable={!readOnly} />
        {pricingOpen && !readOnly && (
          <PricingSlideOut pricing={pricing} onPatch={patchPricing} onRecalculate={recalcPricing} onClose={() => setPricingOpen(false)} />
        )}
```
Remove the now-unused local `fees`/`fetEnabled`/`totalOverride` state setters from the old panel if they are no longer referenced (they now live inside `pricing` via `patchPricing`). Keep the autosave effect from Step 2.

- [ ] **Step 4: Build.** `cd frontend && npm run build` — Expected: success (this compiles `PricingSummary` + `PricingSlideOut` + `pricingRows` for the first time; fix any unresolved import).

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/pages/QuoteEditor.jsx
git commit -m "feat(scheduling): QuoteEditor uses shared Pricing summary + slide-out"
```

---

### Task 10: Wire into the Trip page (rename Fees → Pricing)

**Files:**
- Modify: `frontend/src/pages/SchedulingTripDetail.jsx`

- [ ] **Step 1: Imports + state.** Add at the top:
```jsx
import PricingSummary from '../components/pricing/PricingSummary';
import PricingSlideOut from '../components/pricing/PricingSlideOut';
```
Add state: `const [pricingOpen, setPricingOpen] = useState(false);` and `const [pricingCollapsed, setPricingCollapsed] = useState(false);`

- [ ] **Step 2: Rename the tab.** In the `TABS` array, change `{ id: 'fees', label: 'Fees' }` to `{ id: 'fees', label: 'Pricing' }` (keep the `id` `'fees'` so `tab === 'fees'` checks still work; only the visible label changes).

- [ ] **Step 3: Patch + recalc handlers.** Add (mirroring QuoteEditor):
```jsx
  const patchPricing = (patch) => {
    setMeta((m) => {
      const merged = { ...(m?.pricing || {}), ...patch };
      if (patch.overrides) merged.overrides = patch.overrides;
      const pricing = { ...merged, ...recomputeInputs(merged) };
      return { ...m, pricing };
    });
  };
  const recalcPricing = async () => { await reprice(); };  // reprice() already POSTs /price + reloads
```
Add a debounced autosave effect that watches the pricing edit-fields and PATCHes `/api/scheduling/trips/${tripId}/price-lines` with `{ overrides, costPerHr, posRate, surchargePerHr, landingFee, landings, nights, faCount, crewCount, segmentPerPax, fees, fetEnabled, totalOverride }` pulled from `meta.pricing`, then `setMeta` with the returned pricing. Use the same 700 ms debounce pattern already in QuoteEditor.

- [ ] **Step 4: Replace the Fees-tab body.** Replace the entire `{tab === 'fees' && (<> … </>)}` block with:
```jsx
      {tab === 'fees' && (
        <PricingSummary pricing={meta?.pricing} collapsed={pricingCollapsed} onToggle={() => setPricingCollapsed((c) => !c)} onOpen={() => setPricingOpen(true)} editable={isNative} />
      )}
      {pricingOpen && isNative && (
        <PricingSlideOut pricing={meta?.pricing} onPatch={patchPricing} onRecalculate={recalcPricing} onClose={() => setPricingOpen(false)} />
      )}
```
Remove the now-dead `priceEdit`/`startPriceEdit`/`savePrice`/`updateFee`/`addFee`/`removeFee` helpers if no longer referenced. Keep `reprice` (used by `recalcPricing`). `recomputeInputs` is already imported.

- [ ] **Step 5: Build.** `cd frontend && npm run build` — Expected: success.

- [ ] **Step 6: Commit.**
```bash
git add frontend/src/pages/SchedulingTripDetail.jsx
git commit -m "feat(scheduling): Trip page Fees tab → Pricing summary + slide-out"
```

---

## PHASE 6 — DOCS & VERIFICATION

### Task 11: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1.** §7 (Quoting/pricing): document the per-line `overrides` model, `costPerHr`/`posRate`, `computeFlightCost`, `effectiveHourly`, and that the slide-out edits dollars (pins) with Recalculate as reset. §19: `/price-lines` now persists `costPerHr`/`posRate`/`overrides` and recomputes flight cost on rate change. §20: new `components/pricing/{PricingSummary,PricingSlideOut,pricingRows}`, the Fees tab renamed to **Pricing** (id still `fees`), both the Trip page and Quote editor use the shared components. Keep the "pricing source of truth is backend; feesMath mirrors it (now incl. overrides)" golden rule accurate.

- [ ] **Step 2: Commit.**
```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md — pricing slide-out, per-line overrides, costPerHr/posRate"
```

---

### Task 12: Full verification

**Files:** none (verification only)

- [ ] **Step 1:** `node --test backend/src/scheduling/*.test.js` — Expected: PASS (pricing engine incl. new tests; `supabaseUrl is required` failures from DB-dependent service tests are pre-existing/expected without `.env`).
- [ ] **Step 2:** `node --test frontend/src/lib/*.test.js frontend/src/components/pricing/*.test.js` — Expected: PASS (feesMath lockstep + pricingRows).
- [ ] **Step 3:** `cd frontend && npm run build` — Expected: success.
- [ ] **Step 4: Manual smoke** (document results; do not auto-claim): open a quote → Pricing summary shows; click → slide-out; edit a $ line (pins, accent dot, reset works); edit Cost/Hr (flight cost updates after save); Recalculate clears pins; Total override; "Saved ✓"; same on a booked trip's **Pricing** tab.
- [ ] **Step 5:** `git status --short && git log --oneline -14` — all committed on `feat/pricing-slideout`; pre-existing `.gitignore` untouched.

---

## Self-Review

**Spec coverage:** §1 components → Tasks 7,8 + wiring 9,10. §2 engine (flightCost input, overrides, effectiveHourly, costPerHr/posRate, computeFlightCost) → Tasks 1,2,3,5. §3 components detail → 7,8. §4 edit/persist (pin on $, recompute on rate/count, Recalculate, autosave) → 4,9,10. §5 backend → 4. §6 wiring → 9,10. §7 testing → 1,2,3,5,6,12. §8 edge cases (pin holds, Recalculate wins, Cost/Hr latency) → covered by 4 (ratesChanged+!flightPinned), 2 (repriceFromBase preserves), 8 (UI). §9 docs → 11. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; commands have expected output. ✓

**Type consistency:** `recomputeFromInputs`/`recomputeInputs` identical signature + return (Tasks 1,5). `overrides` keys (`flightCost,surcharge,landingCost,overnightCost,faCost,crewCost,segmentFee`) consistent across engine (1), pin/unpin helpers (6), and slide-out dollarRow calls (8). `computeFlightCost(legs, rateCard, {costPerHr,posRate})` defined (3) and called (4). `costPerHr`/`posRate` emitted by priceTrip (2), persisted by /price-lines (4), edited via inputRow (8). `patchPricing`/`recalcPricing`/`pricingOpen` consistent in both hosts (9,10). `onPatch`/`onRecalculate`/`onClose` props match between components (7,8) and hosts (9,10). ✓
