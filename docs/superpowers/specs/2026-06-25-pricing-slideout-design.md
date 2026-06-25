# Pricing Tab + Slide-Out — Design

**Date:** 2026-06-25
**Status:** Approved design, pending implementation plan
**Scope:** Replace the scheduling **Fees** tab with a **Pricing** experience modeled on LevelFlight:
a collapsible **summary bar** + a right-side **slide-out drawer** for editing, rendered in our dark
dashboard theme but with LevelFlight's edit behavior (edit dollar amounts directly, per-line "pins",
a **Recalculate** reset). Built as shared components used on **both** the booked Trip page and the
Quote editor.

---

## 1. Context & Goal

The booked Trip page (`SchedulingTripDetail.jsx`) has a **Fees** tab with a per-line rate editor; the
Quote editor (`QuoteEditor.jsx`) has its own inline pricing panel. The user wants both to become a
LevelFlight-style **Pricing** UI: a horizontal summary bar that expands into a slide-out drawer of
editable Item/Price rows. Reference screenshots (`PRICING TAB.png`, `PRICING SLIDE OUT.png`) provided.

Pricing math already lives in one place — `scheduling/pricing.js` (`recomputeFromInputs`, `priceTrip`),
mirrored on the frontend by `lib/feesMath.js` (`recomputeInputs`). This feature reuses that engine and
extends it with **per-line overrides**.

### Key decisions (from brainstorming + an approved visual mock)

1. **Two shared components**, used on the Trip page (renamed Fees → **Pricing** tab) and in the Quote
   editor (replacing its inline panel): `PricingSummary` (collapsible bar) + `PricingSlideOut` (drawer).
2. **Edit dollar amounts (LF-faithful).** Each editable line's `$` is directly editable; a hand-edited
   line is **pinned** (an override) and won't change until **Recalculate**. Counts (RON/FA/Crew **Days**,
   **Landings**) and rates (**Cost/Hr**, **Pos/Hr**) are editable too and drive their line unless pinned.
3. **Recalculate** clears **all** line pins **and** the Total override → pure rate-card pricing. (This is
   the existing "Re-price", renamed.)
4. **Total Price** keeps the single override (`totalOverride`), shown on the summary card + drawer footer.
5. **Autosave** (debounced) via the existing `PATCH /trips/:id/price-lines`, consistent with the Quote
   editor. No Save button.
6. **Look:** our dark theme (`--bg-card`/`--bg-secondary`/`--accent`/`--border`), not LF's palette.
   Mock v1 approved.
7. **No migration** — the `pricing` jsonb is extended additively (soft).

### In scope

The two components; the engine's per-line-override extension; the `Pos/Hr` rate; wiring into the Trip
page and Quote editor; extending `/price-lines` to persist overrides + posRate; tests.

### Out of scope (non-goals)

No change to the rate-card data model, the quote/itinerary/trip-sheet documents, the LF mirror, or the
quote↔trip routing. No new pricing concepts beyond what LF's slide-out shows.

---

## 2. Pricing engine extension (`scheduling/pricing.js` + `lib/feesMath.js`)

The aggregation (FET base → FET → total) stays **identical** on backend and frontend (the load-bearing
lockstep). The only math that is **backend-only** is the per-leg **Flight Time Cost** (it needs the legs
+ rate-card `min_hours`/`short_leg`); everything else is simple `rate × qty` that both sides compute.

### `pricing` jsonb — additive fields
- `costPerHr` (number) — **nominal** Cost/Hr (rate-card `hourly_rate`); editable. Shown as "Cost / Hr".
- `posRate` (number) — **nominal** Pos/Hr (rate-card `positioning_rate`); editable. Shown as "Pos / Hr".
- `flightCost` (number) — **per-leg computed** flight cost (revenue legs at `costPerHr`, ferry legs at
  `posRate`, with `min_hours`/`short_leg` flooring). This is "Flight Time Cost"/"Flight Base Cost".
- `overrides` (object) — pinned dollar values, any of:
  `{ flightCost, surcharge, landingCost, overnightCost, faCost, crewCost, segmentFee }`. Presence ⇒ pinned.
- Existing fields kept: `hours`, `surchargePerHr`, `landingFee`, `landings`, `faFee`, `faCount`,
  `crewFee`, `crewCount`, `segmentPerPax`, `pax`, `nights`, `overnightCost`, `fetRate`, `fetEnabled`,
  `fees[]`, `totalOverride`.

### `recomputeInputs` / `recomputeFromInputs` (kept in lockstep)
Signature gains `flightCost`, `overrides`, and `nights`/`overnightRate` (so RON Days drives RON Cost).
Pure aggregation:
```
eff(line, computed) = overrides[line] != null ? overrides[line] : computed
flightCostEff   = eff('flightCost',  flightCost)            // flightCost comes in precomputed
surchargeEff    = eff('surcharge',   surchargePerHr*hours)
landingEff      = eff('landingCost', landingFee*landings)
overnightEff    = eff('overnightCost', max(0,nights-threshold)*overnightRate)
faEff           = eff('faCost',      faFee*faCount)
crewEff         = eff('crewCost',    crewFee*crewCount)
segmentEff      = eff('segmentFee',  segmentPerPax*pax)
feesTaxable / feesNonTaxable  (unchanged, from fees[])
fetBase   = flightCostEff + surchargeEff + landingEff + faEff + crewEff + overnightEff + feesTaxable
fetAmount = fetEnabled ? round(fetBase * fetRate) : 0
computedTotal = fetBase + segmentEff + fetAmount + feesNonTaxable
total = totalOverride != null ? totalOverride : computedTotal
effectiveHourly = hours>0 ? round(flightCostEff / hours) : 0
```
Returns all `*Eff` line values + `fetBase`, `fetAmount`, `computedTotal`, `total`, `effectiveHourly`,
and echoes `overrides`/inputs. `manual` = true if any override or pin is set.

### Per-leg flight cost (backend only)
A helper (extends `priceTrip`/`priceQuoteLegs`) computes `flightCost` from the legs + a rate card whose
`hourly_rate`/`positioning_rate` are overlaid with the edited `costPerHr`/`posRate`. Re-run whenever
legs, `costPerHr`, or `posRate` change (and on Recalculate). `flightCost` is then fed into the
aggregation above. The frontend cannot recompute this; see §4 for the latency note.

---

## 3. Components

### `PricingSummary` (collapsible bar — the "tab")
Horizontal metric columns + a prominent **TOTAL PRICE** card (override pencil). Columns mirror the mock:
Effective Cost/Hr (+ Fees ✎ sub), Flight Time (h:mm) → flightCost (+ Segment sub), Surcharge (+ FET
checkbox + amount sub), Landings, RON (n), FA (n), Crew (n), and the Total card. A collapse chevron and
an "✎ Edit pricing" affordance; clicking the bar or that link **opens the slide-out**. Props: the
`pricing` object + handlers (`onOpen`, `onToggleFet`, `onEditTotal`). Pure presentational.

### `PricingSlideOut` (right drawer)
Header: **↻ Recalculate** · "Pricing" · ✕. An Item/Price list:
- **Cost / Hr** (rate ▲▼) · **Pos / Hr** (rate ▲▼)
- **Flight Time** (read-only h:mm) · **Flight Time Cost** ($ editable→pins) · **Flight Base Cost**
  (read-only bold = flightCostEff) · **Effective Hourly** (read-only derived)
- **Additional:** Fuel Surcharge ($▲▼) · Landings (n) ($▲▼) · RON Days (count ▲▼) · RON Cost ($▲▼) ·
  FA Days (count ▲▼) · FA Cost ($▲▼) · Crew Days (count ▲▼) · Crew Cost ($▲▼) · Segment/pax ($▲▼)
- **FET** (checkbox, amount read-only) · **+ Add fee** (ad-hoc, taxable flag) · **Total Price** ($
  override, ✎/clear).
A pinned line shows a subtle "pinned" indicator (e.g. accent dot) + a small reset-this-line control.
Drawer slides from the right over a dim backdrop; Esc / ✕ / backdrop closes.

Both components live in `frontend/src/components/pricing/` and take the `pricing` object + an
`onChange(patch)` callback; they do **not** talk to the API themselves (the host page owns persistence).

---

## 4. Edit & persist behavior

- **Editing a `$` line** (Flight Time Cost, Surcharge, Landings, RON/FA/Crew Cost, Segment) sets
  `overrides[line]` → **instant** local recompute via `feesMath` (pure sums) → autosave.
- **Editing a count/rate** (RON/FA/Crew **Days**, **Landings** count, **Cost/Hr**, **Pos/Hr**) updates
  the input and recomputes its line. Counts → instant (simple `rate×qty` in `feesMath`). **Cost/Hr and
  Pos/Hr** change `flightCost`, which is per-leg → recomputed on the **backend**; the new value returns
  via autosave (~debounce delay). Until it returns, the line shows the prior `flightCost` (no fake
  blended value). This is the one non-instant edit; documented in the UI with the saving indicator.
- **A pinned line ignores rate/count/leg changes** until reset (its small reset control) or **Recalculate**.
- **↻ Recalculate** → clears `overrides` + `totalOverride`, re-runs the full rate-card `priceTrip`
  (faithful per-leg), persists. Returns to pure rate-card pricing.
- **FET** checkbox → `fetEnabled`. **Total Price** ✎ → `totalOverride` (wins over computed).
- **Persistence:** all edits autosave (debounced ~700 ms) through `PATCH /trips/:id/price-lines`. The
  host (Trip page / Quote editor) shows the existing "Saving… / Saved ✓" indicator.

---

## 5. Backend (`routes/scheduling.js`)

- **`PATCH /trips/:id/price-lines`** — accept and persist `costPerHr`, `posRate`, `overrides`, the
  existing rate/count inputs, `fees`, `fetEnabled`, `totalOverride`. When `costPerHr`/`posRate`/legs
  changed (or on Recalculate), recompute `flightCost` per-leg; otherwise keep the stored `flightCost`.
  Apply `recomputeFromInputs` and return the full `pricing`.
- **`POST /trips/:id/price`** (Recalculate) — re-run the rate-card `priceTrip` (clears overrides +
  totalOverride), persist `costPerHr`/`posRate`/`flightCost`, return pricing.
- **`priceAndStore`/`priceQuoteLegs`** — emit `costPerHr` (= rate-card hourly_rate), `posRate`
  (= positioning_rate), and the per-leg `flightCost`, so the engine has them from the first quote.
- All additive; stores **soft-fail** if fields are absent. **No migration.**

---

## 6. Wiring

- **Trip page** (`SchedulingTripDetail.jsx`): rename the `fees` tab label to **Pricing**; render
  `PricingSummary` as the tab content and `PricingSlideOut` on open. Remove the old inline Fees-tab
  editor (its logic moves into the engine + components). Persist via `price-lines`/`price` (already wired
  to `tripId`).
- **Quote editor** (`QuoteEditor.jsx`): replace the current inline pricing panel with `PricingSummary`
  + `PricingSlideOut`, fed by the same `pricing` state and autosave path it already uses.
- Shared `feeCatalog`/`FEE_CODES` reused for ad-hoc fees.

---

## 7. Testing

`node:test`.
- **Engine** (`pricing.test.js` + `feesMath.test.js` in lockstep): override pins win per line; Recalculate
  semantics (caller clears overrides); FET base includes pinned lines; `effectiveHourly = flightCost/hours`;
  RON Days drives RON Cost unless pinned; total override still wins. Add a shared fixture asserting
  `recomputeFromInputs` (backend) and `recomputeInputs` (frontend) return identical numbers for the same
  inputs incl. overrides.
- **Per-leg flight cost** helper: ferry legs priced at `posRate`, revenue at `costPerHr`, `min_hours` floor.
- **Frontend:** `npm run build`. Components are presentational; covered by the build + the engine tests.

---

## 8. Edge cases

- **Pinned line + Recalculate:** Recalculate wins (clears the pin).
- **Pin then change the rate it derived from:** pin holds (that's the point); reset-line or Recalculate
  to unpin.
- **No rate card / pricing.error:** summary shows "—" with a Recalculate prompt (today's behavior).
- **Cost/Hr edit latency:** flightCost updates after autosave returns; the saving indicator covers it.
- **Existing trips** priced before this ships lack `costPerHr`/`posRate`/`flightCost`/`overrides`; the
  engine falls back (costPerHr ← derived effective rate, no overrides) and a Recalculate fully reseats them.

---

## 9. Documentation

Update `CLAUDE.md` in the same change: §7 (pricing — per-line overrides, Pos/Hr, the slide-out edit model),
§19 (`/price-lines` now persists `overrides`/`costPerHr`/`posRate`), §20 (the Pricing tab + slide-out
components; Fees tab renamed; Quote editor uses the shared component). Keep the "pricing source of truth
is the backend; feesMath mirrors it" golden rule accurate (now includes `overrides`).
