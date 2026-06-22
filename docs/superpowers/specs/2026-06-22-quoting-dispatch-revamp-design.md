# Quoting → Dispatch Revamp — Design

**Date:** 2026-06-22
**Status:** Approved design, pending implementation plan
**Scope:** Revamp the existing native quote system into a polished, LevelFlight-parity
**quote → dispatch** flow that exjet-dashboard fully owns.

---

## 1. Context & Goal

LevelFlight (LF) is being rebuilt as Exjet's own software. A native quote/trip system
**already exists** in the repo (`scheduling_trips` + `SchedulingNewTrip.jsx` +
`SchedulingTripDetail.jsx` + `scheduling/pricing.js` + `rate_cards`). This project is a
**revamp to make it excellent and bring it to LF parity**, not a greenfield build.

The reference flow (observed in LF):

| Stage | Identity | Key inputs | Actions |
|---|---|---|---|
| **Create Quote** | Quote # | Aircraft → Company/Contact → leg chain (date/time/from/to/pax); ETE+dist+arrival auto-computed | Save |
| **Quote detail** | Quote # (+ versions) | Purpose, **Rate** profile, Notes; **Fees** = base + surcharge + landings + RON + FA + segment + FET + ad-hoc → Total | View Quote/Itin/Sheet/Invoice, **Book Quote** |
| **Dispatch** | Trip # + Quote # | + Booked-by, + Checklist (contract/payment), per-leg FBO/crew/pax | **Release Legs**, TSA, Payments |

### Key decisions (made during brainstorming)

1. **Ownership:** Native quotes/dispatches are **owned in our DB** (`origin='native'`). LF
   stays read-only for already-mirrored trips. New trips never need to exist in LF.
2. **Documents** (quote/itinerary/trip-sheet) keep the existing **"Midnight" branded
   format**; we only change their view-model **source** from LF's `getTripLog(dispatchId)`
   to native trip data. No document redesign.
3. **Pages** stay in the **app's existing dark theme** (cleaner, sectioned/tabbed like LF) —
   not recolored into the documents' Midnight palette.
4. **Frontend structure:** an **LF-style tabbed Trip Overview** (validated via mockup).
5. **Rate cards by Purpose:** owner vs charter are **separate rate cards per tail**
   (`N69FP` / `N69FP CHARTER`), with full add/edit/delete.
6. **Contacts:** lightweight company + contact stored **on the trip** (with autocomplete),
   not a new CRM/contacts directory.
7. **FBOs:** sourced from LF (`https://rest.levelflight.com/api/airport/fbo/{ICAO}`,
   probe-verified), **broad bulk import** into our own DB.
8. **Numbering** (Quote#/Trip#): provisional local sequence now; the real scheme is
   **deferred to the LF cutoff project**.

### In scope

Quote builder + full Fees + Book→Dispatch view + the three native documents + FBO directory.

### Out of scope (later specs)

Crew-assignment deep features beyond the existing PIC/SIC/FA, TSA Secure Flight filing,
Payments/QuickBooks push, and the broader LF-cutoff/migration work.

---

## 2. Architecture Overview

The **backend is largely reusable**. Shared work regardless of UI: extend the Fees model,
add FBO directory, and refactor the three document view-models to a native source. The
frontend becomes a tabbed Trip Overview shell.

```
New Quote page ──POST /api/scheduling/trips──▶ scheduling_trips (origin=native, status=quote)
        │                                              │
        │  pickRateCard(tail,purpose)                  │ pricing.js → pricing(jsonb)
        ▼                                              ▼
  Trip Overview (tabbed)  ◀── GET /api/scheduling/trips/:id ──┐
   Legs · Fees · Crew · Pax · Documents                       │
        │ Book → Dispatch (PATCH status)                      │
        ▼                                                     │
  trip_number + booked_by/at assigned                         │
        │                                                     │
        ▼                                                     │
  Documents ── nativeTripVM ──▶ quoteHtml / itineraryHtml / tripSheetHtml (unchanged)
                                   (uuid → native;  24-hex → existing LF path)
  FBO pickers ── GET /api/scheduling/airport/:icao/fbos ──▶ airport_fbos (bulk-imported)
```

---

## 3. Data Model — migration `018`

`scheduling_trips` already has `purpose`, `rate_name`, `quote_number`, `trip_number`,
`pricing` (jsonb). Migration `018` is additive; stores **soft-fail** until applied.

### `rate_cards` (add columns)
- `label` (text) — e.g. `"N69FP"` vs `"N69FP CHARTER"` (the LF "Rate" name).
- `purpose` (text: `owner` | `charter` | null) — one card per (tail, purpose).
- Selection rule: Purpose → `(tail, purpose)` card → store its `label` in
  `scheduling_trips.rate_name`. Falls back to the tail's default card.

### `scheduling_trips` (add columns)
- `company_name` (text) and `contact` (jsonb `{ name, email, phone }`) — native Company→Contact.
- `checklist` (jsonb `{ contractReceived, paymentReceived, paymentProcessed }`).
- `booked_by` (text) + `booked_at` (timestamptz) — set on the Book transition.

### `scheduling_legs` (FBO snapshot)
`dep_fbo` / `arr_fbo` already exist. Ensure they can store a snapshot
`{ fbo_id, name, phone, email }` (widen to jsonb or add `dep_fbo_id`/`arr_fbo_id` +
snapshot columns if the existing columns are plain text). The snapshot keeps documents
stable even if the FBO directory later changes.

### `airport_fbos` (new table)
`fbo_id` (text, pk) · `icao` (text, indexed) · `name` · `address` (jsonb) · `lat`
(numeric) · `lng` (numeric) · `phones` (jsonb) · `fax` · `email` · `website` · `comms`
(jsonb) · `hours` · `raw` (jsonb) · `synced_at` (timestamptz).

### `pricing` jsonb (extended in place — no DDL)
Adds to the existing breakdown:
- `fees: [{ code, description, amount, taxable }]` — ad-hoc Fees line items.
- `fetEnabled` (bool) — FET on/off (default: `true` charter, `false` owner).
- `nights` (number) — RON nights × rate-card overnight rate.
- `totalOverride` (number | null) — manual final total; wins over computed total.

---

## 4. Pricing & Fees Engine

**`scheduling/pricing.js` (single source of truth) — extend existing functions:**
- `priceTrip` / `recomputeFromInputs` gain `nights × overnightRate` (RON), `fees[]`,
  `fetEnabled`, `totalOverride`.
- **FET base** = `flight + surcharge + landing + FA + crew + overnight + (taxable ad-hoc fees)`.
- **FET** = `fetEnabled ? fetRate × fetBase : 0`.
- **Total** = `fetBase + FET + segmentFee + (non-taxable ad-hoc fees)`, **unless**
  `totalOverride != null` → override is the total (show "adjusted" badge, like today's `manual`).
- New helper `pickRateCard(tail, purpose)` → the `(tail,purpose)` card (fallback to default);
  returns `fetRate` too (charter card 7.5%, owner card 0).
- The frontend mirror (`recomputeInputs` in the detail page) is updated to match exactly.

**Rate-card CRUD (`routes/rateCards.js` + `RateCards.jsx`) — extend, keep CRUD:**
add `label` + `purpose` to create/edit; allow multiple cards per tail; list grouped by tail.

**Scheduling routes (`routes/scheduling.js`):**
- `POST /trips` (create): accept `purpose`, `company_name`, `contact`; select rate card via
  `pickRateCard`; store `rate_name`; default `fetEnabled` from purpose.
- Extend `PATCH /trips/:id/price-lines` to also persist `fees[]`, `fetEnabled`,
  `totalOverride` (one save path for the whole Fees tab).
- `PATCH /trips/:id/checklist` — persist the 3 checklist booleans.
- **Book transition** (status→booked): assign `trip_number` (next sequence), stamp
  `booked_by` (`req.user`) + `booked_at`. Quote# assigned at creation. (Owner vs charter:
  owner defaults FET off + segment $0.)

**Numbering:** provisional monotonic local sequence (Quote# at create, Trip# at Book) with a
clear seam; the real scheme is set during the **LF cutoff**.

---

## 5. Native Documents + FBO Directory

### Document view-models (renderers unchanged)
`quoteHtml.js`, `itineraryHtml.js`, `tripSheetHtml.js` stay exactly as-is (the Midnight
look). New adapter **`nativeTripVM.js`** (three builders) maps `scheduling_trips` +
`scheduling_legs` + manifest + crew + `pricing` into the **same VM shapes** the renderers
already consume:
- **Quote VM:** tail/type/maxPax, legs (dep/arr/time + distance/EFT from the flight-time
  engine, pax), `total` from `pricing.total`, `quoteNumber`, "PREPARED FOR" = `company_name`
  (→ contact), `preparedOn`, native `acceptUrl`.
- **Itinerary VM:** legs with pax, **lead passenger** = unique lowest seat from the manifest,
  crew (PIC/SIC/FA), FBOs (snapshot), weather (existing fetch).
- **Trip Sheet VM:** crew release, pax manifest, aircraft specs + maintenance, METARs, FBOs.

**Routing:** doc routes branch on id shape — **uuid → native VM path; 24-hex → existing LF
path**. Applies to `/quote/:id` (+`/pdf`), `/itinerary/:id` (+`/pdf`), trip-sheet route.
Map coords come from our airport lookup (same coords the map script expects).

**Native accept link:** public, idempotent endpoint that records client acceptance + notifies
(no PII exposed). Replaces LF's accept URL on native quotes.

### FBO directory (bulk import)
- **`services/fbos.js`** — `fetchAirportFbos(icao)` (verified LF call), `importFbos(icaos[])`
  (upsert into `airport_fbos`), `listFbos(icao)` (from our DB).
- **Route** `GET /api/scheduling/airport/:icao/fbos` — serves from our DB; lazily
  fetches+caches from LF on first request for an airport.
- **Leg editor** gets dep/arr FBO dropdowns; the chosen FBO snapshot is stored on the leg.
- **Bulk import** iterates a **master airport list** (app's airport reference data, filtered
  to jet-capable: US + common international, paved runway above a length threshold). The
  importer is **rate-limited, idempotent, resumable** (tracks done ICAOs, logs zero-FBO
  airports, refreshes LF auth mid-run). Runs as a backend script after `018` is applied;
  re-runnable to refresh. Lazy cache backstops anything outside the bulk set.

LF FBO response shape (probe-verified):
`{ success, message, fbos: { "<id>": { id, name, address{street,city,state,postalCode,country},
loc{coordinates:[lng,lat]}, phones[], fax, email, website, comms{...}, hours } } }`.

---

## 6. Frontend — LF-style tabbed Trip Overview

Refactor the single 660-line `SchedulingTripDetail.jsx` into focused components.

**Identity + actions:**
- **Header:** route-summary title · **Quote #** always · **Trip #** once booked · status pill
  · Edit/Delete (native) · **Booked by** after booking.
- **Trip Info card:** Aircraft · Company → Contact · **Purpose** · **Rate** (auto by Purpose,
  overridable) · Created-by/Booked-by.
- **Actions rail:** View Quote · View Itinerary · View Trip Sheet · **Book → Dispatch** /
  Release / Cancel (from backend `actions`).

**Tabs:**
- **Legs** — list + editor (add/remove/reorder, dep/arr/time/pax/ferry) + dep/arr **FBO pickers**.
- **Fees** — auto lines (flight · surcharge · RON · FA · crew · landings · segment) + **ad-hoc
  fee editor** (Code catalog · Description · Amount · **Taxable**) + **FET on/off** + **manual
  total override** + Re-price; live recompute matches backend.
- **Crew** — PIC/SIC/FA assignment (existing).
- **Pax** — manifest from people directory (existing) + lead-passenger highlight.
- **Documents** — **View/Send Quote** (native) · Itinerary · Trip Sheet · uploads · functional
  **Trip Checklist** (contract / payment received / processed).

**Components:** `TripOverviewHeader`, `TripInfoCard`, `TripActions`, `LegsTab`
(+`LegFboPicker`), `FeesTab` (+`AdHocFeeRow`, `feeCatalog`), `CrewTab`, `PaxTab`,
`DocumentsTab`, `TripChecklist`.

**Style:** app dark theme (`--bg-card`/`--accent` tokens), sectioned + tabbed. Layout
validated via mockup.

---

## 7. New-Quote Creation Page

Upgrade `SchedulingNewTrip.jsx`:
- **Aircraft** — dynamic fleet (from aircraft/rate-card list, not hardcoded).
- **Company → Contact** — company autocomplete from prior trips; contact name/email/phone.
- **Purpose** (owner/charter) → auto-selects the matching rate card.
- **Legs builder** — existing live ETE/distance/ETA + optional dep/arr FBO pickers.
- **Live price preview** — running total as you build.
- **Create** → Trip Overview at `quote` status.

---

## 8. Lifecycle & Numbering

`quote → booked (dispatch) → released → closed`, with `cancelled` until closed
(`scheduling/workflow.js` already defines transitions + next-actions). **Quote#** at create,
**Trip#** + **booked_by/at** at Book. Provisional local sequence; real scheme deferred to the
LF cutoff.

---

## 9. Testing

All `node:test` (repo convention).
- **Backend units** — `pricing.js`: taxable ad-hoc fee → FET base; FET on/off; total override
  wins; RON nights × rate; `pickRateCard(tail,purpose)`. `nativeTripVM` builders produce the
  exact VM shape each renderer expects. `fbos.js` parses the LF `{fbos:{id:{…}}}` shape.
  Numbering sequence.
- **Frontend** — `recomputeInputs` mirror matches backend; `npm run build` check.

---

## 10. Edge Cases & Error Handling

- Stores **soft-fail** if `018` not applied (deploys don't break pre-migration).
- Doc routes branch **uuid (native) vs 24-hex (LF)**; clean not-found handling.
- **FBO import:** rate-limited, resumable, logs zero-FBO airports, refreshes LF auth mid-run.
- **Total override × Re-price:** Re-price clears the override, returns to rate-card calc.
- **Native accept link:** public, idempotent, records acceptance + notifies; no PII exposed.
- Owner defaults **FET off + segment $0**; charter defaults FET on.
- Unknown-airport pricing already handled (existing estimate fallback).

---

## 11. Open Items (for the LF cutoff project)

- Final Quote#/Trip# numbering scheme (mirror LF vs fresh local sequence).
- Whether native dispatches ever sync back to LF, or LF is fully retired for new business.
- TSA Secure Flight, Payments/QuickBooks, and deeper ops checklist wiring.
