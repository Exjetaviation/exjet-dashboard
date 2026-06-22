# Quoting → Dispatch Revamp — Phase C2 (Fees tab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Bring the **Fees tab** (in the Phase-C1 Trip Overview) to LevelFlight parity: extract + extend the frontend pricing mirror to match the backend exactly (ad-hoc fees, FET on/off, total override), and add the UI for **ad-hoc fee line items** (Code + Description + Amount + Taxable), an **FET toggle**, and a **manual total override** — all wired to the existing `PATCH /trips/:id/price-lines` (which already accepts these).

**Architecture:** Extract the inline `recomputeInputs` into a pure, unit-tested `frontend/src/lib/feesMath.js` that is a faithful mirror of the backend `recomputeFromInputs` (so the on-screen total always matches the persisted `pricing.total`). Add a `feeCatalog.js` for the fee Code dropdown. Extend `priceEdit` state + the Fees panel render in `SchedulingTripDetail.jsx`. No backend changes — the `price-lines` route already persists `fees`/`fetEnabled`/`totalOverride` (Phase A).

**Tech Stack:** React + Vite, `node:test` (frontend lib tests run via `node --test frontend/src/lib/*.test.js`), inline styles with the app CSS variables. Build check: `cd frontend && npm run build`.

**Phase context:** C2 of Phase C; depends on C1 (the tabbed Overview — merged). The Fees panel currently lives under the `fees` tab as the old pricing card. C2 extends it. Backend `recomputeFromInputs` (the source of truth this mirrors) is at `backend/src/scheduling/pricing.js:25` and already returns `fees, feesTaxable, feesNonTaxable, fetEnabled, fetBase, fetAmount, computedTotal, totalOverride, total`.

**Conventions:** Never print secrets. Match the existing inline-style + edit-mode patterns in `SchedulingTripDetail.jsx`.

---

## File Structure

**Create:**
- `frontend/src/lib/feesMath.js` — pure `recomputeInputs(inputs)` (mirror of backend `recomputeFromInputs`).
- `frontend/src/lib/feesMath.test.js` — its tests (mirror the backend pricing tests).
- `frontend/src/lib/feeCatalog.js` — `FEE_CODES` array for the ad-hoc fee Code dropdown.

**Modify:**
- `frontend/src/pages/SchedulingTripDetail.jsx` — import `recomputeInputs` from `feesMath` (remove the inline copy); extend `startPriceEdit` (carry `fees`/`fetEnabled`/`totalOverride`); add ad-hoc fee handlers; extend the Fees panel render (ad-hoc fee rows + FET toggle + total override).

---

## Task 1: Pure fees math (mirror the backend)

**Files:** Create `frontend/src/lib/feesMath.js` + `frontend/src/lib/feesMath.test.js`

- [ ] **Step 1: Write the failing test** (same cases as the backend `pricing.test.js`, so the mirror is provably faithful)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recomputeInputs } from './feesMath.js';

const base = {
  hourlyRate: 8500, hours: 2, surchargePerHr: 1800, faFee: 700, faCount: 1,
  crewFee: 0, crewCount: 0, landingFee: 0, landings: 2,
  segmentPerPax: 0, pax: 4, overnightCost: 1500, fetRate: 0.075,
};

test('taxable ad-hoc fee joins the FET base', () => {
  const r = recomputeInputs({ ...base, fees: [{ amount: 1000, taxable: true }] });
  assert.equal(r.fetBase, 23800);
  assert.equal(r.fetAmount, Math.round(23800 * 0.075));
});
test('non-taxable fee excluded from FET base, added to total', () => {
  const r = recomputeInputs({ ...base, fees: [{ amount: 1000, taxable: false }] });
  assert.equal(r.fetBase, 22800);
  assert.equal(r.total, 22800 + r.fetAmount + 1000);
});
test('FET toggle off zeroes FET', () => {
  assert.equal(recomputeInputs({ ...base, fetEnabled: false }).fetAmount, 0);
});
test('totalOverride wins', () => {
  const r = recomputeInputs({ ...base, totalOverride: 25000 });
  assert.equal(r.total, 25000);
  assert.equal(r.totalOverride, 25000);
  assert.notEqual(r.computedTotal, 25000);
});
test('default keeps FET on (backward compatible)', () => {
  const r = recomputeInputs(base);
  assert.equal(r.fetAmount, Math.round(r.fetBase * 0.075));
  assert.equal(r.totalOverride, null);
});
```

- [ ] **Step 2: Run it — FAIL**
Run: `node --test frontend/src/lib/feesMath.test.js`

- [ ] **Step 3: Implement** (identical logic to `backend/src/scheduling/pricing.js` `recomputeFromInputs`)

```js
// Pure mirror of the backend recomputeFromInputs (backend/src/scheduling/pricing.js).
// Keep this in lockstep with the backend so the on-screen total equals the persisted
// pricing.total. Taxable ad-hoc fees join the FET base; non-taxable fees are added
// after FET. fetEnabled===false disables FET. totalOverride (when set) wins.
export const recomputeInputs = (i) => {
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
  const fetEnabled = i.fetEnabled !== false;
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

- [ ] **Step 4: Run it — PASS** (5 tests)
Run: `node --test frontend/src/lib/feesMath.test.js`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/feesMath.js frontend/src/lib/feesMath.test.js
git commit -m "feat(fees): pure frontend fees math mirroring the backend"
```

---

## Task 2: Fee catalog

**Files:** Create `frontend/src/lib/feeCatalog.js`

- [ ] **Step 1: Write it** (the LevelFlight fee Code list, observed in the LF Fees dropdown)

```js
// Ad-hoc fee Codes (the "New Fee" dropdown). Mirrors LevelFlight's fee catalog.
export const FEE_CODES = [
  'Pax Transportation (Uber)', 'Crew Rental Car', 'Pax Rental Car', 'Pax Hotel',
  'Crew Hotel', 'Crew Meals', 'Crew Per-diem', 'Catering', 'De-ice',
  'Overflight Permits', 'Tips / Gratuity', 'Aircraft Parts', 'Aircraft Supplies',
  'Aircraft Cleaning', 'Contract Crew', 'Dry Lease', 'Dry Lease Tax 7%', 'Other',
];
```

- [ ] **Step 2: Build check** — `cd frontend && npm run build` → succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/feeCatalog.js
git commit -m "feat(fees): ad-hoc fee Code catalog"
```

---

## Task 3: Wire the Fees panel — ad-hoc fees + FET toggle + total override

**Files:** Modify `frontend/src/pages/SchedulingTripDetail.jsx`

**READ the current file first.** The Fees panel is under `{tab === 'fees' && ...}` — it's the `meta?.pricing && (meta.pricing.error ? ... : (() => { ... })())` expression. Inside the IIFE: `editing = priceEdit != null`, `live = editing ? recomputeInputs(priceEdit) : p`, an `ni(key, w)` number-input helper, a table of view/edit rows, an FET row, and a Total row.

- [ ] **Step 1: Replace the inline `recomputeInputs` with the shared module.** Delete the inline `const recomputeInputs = (i) => {...}` (the function near the top, ~lines 25-37) and add an import at the top:

```jsx
import { recomputeInputs } from '../lib/feesMath';
import { FEE_CODES } from '../lib/feeCatalog';
```

- [ ] **Step 2: Extend `startPriceEdit`** (~line 180) to carry the new fields from the stored pricing (add these three keys to the object passed to `setPriceEdit`):

```jsx
      overnightCost: p.overnightCost || 0, fetRate: p.fetRate || 0,
      fees: Array.isArray(p.fees) ? p.fees.map((f) => ({ ...f })) : [],
      fetEnabled: p.fetEnabled !== false,
      totalOverride: p.totalOverride ?? null,
```
(Keep all existing keys; just append these three. `savePrice` already PATCHes the whole `priceEdit` to `/price-lines`, which persists `fees`/`fetEnabled`/`totalOverride`.)

- [ ] **Step 3: Add ad-hoc fee handlers** (near `startPriceEdit`/`savePrice`):

```jsx
  const updateFee = (idx, field, value) =>
    setPriceEdit((d) => ({ ...d, fees: d.fees.map((f, i) => (i === idx ? { ...f, [field]: value } : f)) }));
  const addFee = () =>
    setPriceEdit((d) => ({ ...d, fees: [...(d.fees || []), { code: FEE_CODES[0], description: '', amount: 0, taxable: true }] }));
  const removeFee = (idx) =>
    setPriceEdit((d) => ({ ...d, fees: d.fees.filter((_, i) => i !== idx) }));
```

- [ ] **Step 4: Render the ad-hoc fees + FET toggle + total override in the Fees panel's EDIT mode.**

Inside the IIFE's returned JSX, in the **editing** branch (where the rate-input rows like `Flight · {ni('hourlyRate')}/hr` are), AFTER the existing editable rate rows (after the Segment row) and BEFORE the FET row, insert the ad-hoc fees editor:

```jsx
                <tr><td colSpan={2} style={{ paddingTop: 10, fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '.04em' }}>AD-HOC FEES</td></tr>
                {(priceEdit.fees || []).map((f, i) => (
                  <tr key={i}>
                    <td style={{ padding: '3px 0' }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <select value={f.code || ''} onChange={(e) => updateFee(i, 'code', e.target.value)}
                          style={{ ...inp, padding: '4px 6px', fontSize: 12 }}>
                          {FEE_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <input value={f.description || ''} onChange={(e) => updateFee(i, 'description', e.target.value)} placeholder="Description"
                          style={{ ...inp, padding: '4px 6px', fontSize: 12, flex: '1 1 120px' }} />
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
                          <input type="checkbox" checked={!!f.taxable} onChange={(e) => updateFee(i, 'taxable', e.target.checked)} /> Taxable
                        </label>
                        <button onClick={() => removeFee(i)} style={{ padding: '2px 7px', fontSize: 11, background: 'var(--bg-secondary)', color: 'var(--danger)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>✕</button>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <input type="number" value={f.amount} onChange={(e) => updateFee(i, 'amount', e.target.value)}
                        style={{ width: 78, textAlign: 'right', padding: '2px 5px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 5 }} />
                    </td>
                  </tr>
                ))}
                <tr><td colSpan={2} style={{ padding: '4px 0' }}>
                  <button onClick={addFee} style={{ padding: '4px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>+ New Fee</button>
                </td></tr>
```

Then **change the existing FET row** so that in edit mode it shows a toggle that disables FET (replace the FET `<tr>` with a version that, when `editing`, renders a checkbox bound to `priceEdit.fetEnabled`):

```jsx
                <tr>
                  <td>{editing ? (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input type="checkbox" checked={priceEdit.fetEnabled !== false}
                        onChange={(e) => setPriceEdit((d) => ({ ...d, fetEnabled: e.target.checked }))} />
                      FET ({Math.round(fetRate * 1000) / 10}%)
                    </label>
                  ) : `FET (${Math.round(fetRate * 1000) / 10}%)`}</td>
                  <td style={{ textAlign: 'right' }}>{usd(live.fetAmount)}</td>
                </tr>
```

Then **change the Total row** so that in edit mode it offers a manual override input (when `totalOverride` is set it wins; a "↺" clears it back to computed):

```jsx
                <tr>
                  <td style={{ paddingTop: 6, fontWeight: 700, color: 'var(--text-primary)' }}>Total{!editing && p.totalOverride != null ? ' · adjusted' : ''}</td>
                  <td style={{ paddingTop: 6, textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {editing ? (
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                        <input type="number" value={priceEdit.totalOverride ?? ''} placeholder={String(live.computedTotal)}
                          onChange={(e) => setPriceEdit((d) => ({ ...d, totalOverride: e.target.value === '' ? null : e.target.value }))}
                          style={{ width: 96, textAlign: 'right', padding: '2px 5px', fontSize: 13, fontWeight: 700, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 5 }} />
                        {priceEdit.totalOverride != null && priceEdit.totalOverride !== '' &&
                          <button title="Clear override" onClick={() => setPriceEdit((d) => ({ ...d, totalOverride: null }))}
                            style={{ padding: '2px 7px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>↺</button>}
                      </span>
                    ) : usd(live.total)}
                  </td>
                </tr>
```

Also, in the **view** (non-editing) breakdown rows, add a line that shows any saved ad-hoc fees (after the segment-fee view row):

```jsx
                    {Array.isArray(p.fees) && p.fees.length > 0 && p.fees.map((f, i) => (
                      <tr key={`vf${i}`}><td>{f.code}{f.description ? ` · ${f.description}` : ''}{f.taxable ? '' : ' (non-tax)'}</td><td style={{ textAlign: 'right' }}>{usd(Number(f.amount) || 0)}</td></tr>
                    ))}
```

(The header `Quote — {usd(live.total)}` and the footnote already reference `live.total`, which now reflects fees/FET/override automatically because `recomputeInputs` handles them.)

- [ ] **Step 5: Build check** — `cd frontend && npm run build` → succeeds (watch for undefined `inp`/`usd`/`ni`/`fetRate`/`p`/`live` — all are existing locals in scope).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/SchedulingTripDetail.jsx
git commit -m "feat(fees): ad-hoc fee rows, FET toggle, manual total override in the Fees tab"
```

---

## Task 4: Verification

- [ ] **Step 1: Tests + build**
Run: `node --test frontend/src/lib/feesMath.test.js` → 5 pass. `cd frontend && npm run build` → green.

- [ ] **Step 2: Manual checklist** (user, on a native quote's Fees tab):
  - Edit the Fees → the auto lines (flight/surcharge/RON/FA/crew/landings/segment) show; adding a **New Fee** (pick a Code, set Amount, toggle Taxable) updates the **FET** and **Total** live; toggling **FET off** zeroes FET; typing a **total override** makes the Total that value (with "↺" to clear); Save persists, and the saved total matches what's shown (frontend mirror == backend).
  - Re-price still reverts to the rate-card calc.

---

## C2 — Definition of Done

- `node --test frontend/src/lib/feesMath.test.js` passes (5) and matches the backend `pricing.test.js` cases.
- `cd frontend && npm run build` passes.
- The Fees tab edits ad-hoc fees (Code/Description/Amount/Taxable), toggles FET, and overrides the total; the on-screen total equals the persisted `pricing.total` after Save.

## Notes for later C-phases
- C3 adds dep/arr FBO pickers in the Legs tab (+ the backend `buildNativeLeg` FBO snapshot).
- C4 wires the checklist (`PATCH /checklist`) + adds View/Send native Quote to the Documents tab, and restores the cosmetic "Closes automatically…" released note dropped in C1.
- C5 upgrades the New-Quote page (Purpose→rate, Company+Contact, dynamic fleet, live price using this same `feesMath`).
