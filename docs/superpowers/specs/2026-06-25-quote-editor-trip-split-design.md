# Quote Editor / Quote↔Trip Split — Design

**Date:** 2026-06-25
**Status:** Approved design, pending implementation plan
**Scope:** Split the scheduling flow into a streamlined **Quote editor** (distinct URL,
keyed by Quote #) and the existing **booked-Trip page** (keyed by Trip #), backed by the
**same** `scheduling_trips` row. Surface working flight time on the quote, make client info
editable, and let legs be added/deleted inline (no "edit flight" modal).

---

## 1. Context & Goal

The native quote/trip system exists (`scheduling_trips` + `SchedulingNewTrip.jsx` +
`SchedulingTripDetail.jsx` + `scheduling/pricing.js`). Today **one tabbed page**
(`SchedulingTripDetail` at `/scheduling/trips/:id`, uuid-keyed) renders the same 5 tabs
(Legs · Fees · Crew · Passengers · Docs) for **every** status — quote, booked, released,
closed. Legs are edited behind an "✎ Edit trip" modal. Flight time/ETE already works on the
**New Trip** page (`useLegEstimate` → `GET /api/scheduling/leg-estimate`) but is **not
surfaced** on the trip-detail Legs tab. Client info (`company_name`/`contact`) is set only at
create — there is no edit UI and `PATCH /trips/:id/details` ignores those fields.

**Goal:** give quotes their own focused page for "build it and send it to the client," and
keep the full operational surface (passengers/crew/documents) on the booked trip page only.

### Key decisions (made during brainstorming)

1. **Two URLs, one row.** A single `scheduling_trips` row carries both `quote_number` and
   `trip_number`. Quote editor → `/scheduling/quotes/:quoteNo`; booked trip →
   `/scheduling/trips/:tripNo`. Both resolve to the same row and cross-link. **No new schema**
   (`quote_number`, `trip_number`, `company_name`, `contact`, `pricing`, `purpose`,
   `rate_name` all already exist).
2. **Status gates the experience.** `status='quote'` → the new streamlined Quote editor;
   `booked/released/closed` → the existing tabbed Trip page. Booking flips which page is the
   editing home; the quote URL remains valid (read-only) afterward.
3. **Quote page contents only:** legs (inline add/delete), per-leg flight time, **per-leg
   pax**, client info (editable), a compact **auto-priced + light-controls** pricing summary,
   and the quote-send buttons. **Not on the quote page:** passenger manifest, crew/pilots,
   documents, itinerary send, trip sheet.
4. **Per-leg pax** (today's model — each leg its own count; ferry legs 0).
5. **Auto-priced + light controls:** price recomputes from legs/pax/rate card; the page
   exposes rate-card pick, **ad-hoc fees**, and a **total override** — a slim view of the
   existing Fees engine, not a separate tab.
6. **Autosave** (debounced) with a "Saving… / Saved ✓" indicator — no Save button, no modal.
7. **Quote document unchanged.** Send buttons reuse the existing `/quote/:id` (+ `/pdf`) dark
   "Midnight" renderer — same format as the dashboard. No itinerary, no trip sheet here.
8. **Trip page keyed by `trip_number`**, with **uuid back-compat** so existing internal links
   keep working.

### In scope

The Quote editor page, its routing + number resolution, editable client info, inline
leg add/delete with live flight time, the compact pricing panel, autosave, the quote-send
buttons, and the cross-links between quote and trip.

### Out of scope (non-goals)

No change to the rendered quote document format, the pricing math, the LF mirror/sync, or the
booked tabbed Trip page structure. No itinerary/trip-sheet on the quote page. No passenger
directory / crew / documents work.

---

## 2. Architecture Overview

The **backend is largely reusable** — two small additive changes (number resolution +
client-info persistence). The frontend gains a focused `QuoteEditor` page (evolved from
`SchedulingNewTrip`, reusing its working ETE/price-preview/leg-row code) and the booked Trip
page keeps `SchedulingTripDetail` intact plus a cross-link.

```
"New Quote" ──POST /api/scheduling/trips (draft)──▶ scheduling_trips (origin=native, status=quote, quote_number=N)
     │                                                        │
     ▼  redirect                                              │
/scheduling/quotes/:quoteNo ──GET /api/scheduling/quotes/:quoteNo──▶ resolves row by quote_number
     │  QuoteEditor (one screen)                              │
     │   legs (inline add/del) · per-leg ETE/ETA · pax        │ autosave:
     │   client info · compact pricing · send buttons         │   PATCH /trips/:id/details   (legs/aircraft/client → reprice base)
     │                                                        │   PATCH /trips/:id/price-lines (rate card / ad-hoc fees / override)
     │  Book → PATCH /trips/:id {status:'booked'}             │
     ▼  assigns trip_number, redirect                         ▼
/scheduling/trips/:tripNo ──GET /api/scheduling/trips/:tripNo (number OR uuid)──▶ SchedulingTripDetail
     Legs · Fees · Crew · Passengers · Docs   (unchanged)     │
     "← Quote N" cross-link                                   │
                                                              ▼
                 Send buttons → public /quote/:id (+/pdf)  (existing Midnight renderer, unchanged)
```

---

## 3. Routing & number resolution

**Frontend routes** (in `App.jsx`, `SchedulingApp` shell):
- `/scheduling/quotes/:quoteNo` → `QuoteEditor`.
- `/scheduling/trips/:tripNo` → `SchedulingTripDetail` — `:tripNo` is a **trip_number OR a
  uuid** (back-compat for existing links).
- `/scheduling/new` → creates a draft quote then redirects into the editor (see §7).

**Backend resolution** (`routes/scheduling.js`):
- New `GET /api/scheduling/quotes/:quoteNumber` → returns the same payload shape as
  `GET /trips/:id` for the row whose `quote_number` matches.
- Extend `GET /api/scheduling/trips/:id`: if the param is a uuid or 24-hex, behave as today;
  otherwise treat it as a **trip_number** and resolve the row. (Reuse `UUID_RE`/`tripColumn`;
  numbers are TEXT — compare as TEXT, never SQL `ORDER BY`.)
- All **mutations stay uuid-keyed** — the page reads `id` from the resolved payload and uses
  the existing `PATCH /trips/:id/*` endpoints unchanged.

**Status redirects:**
- `/scheduling/quotes/:quoteNo` on a **booked+** row → render read-only (summary + send
  buttons + "Booked as Trip N →" link). The row is shared, so it reflects current data.
- `/scheduling/trips/:tripNo|uuid` on a **quote**-status row → redirect to its quote editor.

---

## 4. The Quote Editor page (`frontend/src/pages/QuoteEditor.jsx`)

One screen, always editable, no "edit flight" modal. Evolved from `SchedulingNewTrip.jsx`
(which is retired/absorbed — its leg-row, `useLegEstimate`, `useQuotePreview` code moves here).

**Header / identity:**
- **Quote #** shown; status pill; once booked, a "Booked as Trip N →" link to the trip page.
- **Aircraft (tail)** + **Purpose** (owner/charter) pickers — drive rate-card selection.

**Legs section (the centerpiece):**
- Inline leg rows reusing the existing `LegRow`: From / To (`AirportInput`) · Date · ETD-local
  (+ Zulu caption) · **Pax** (per-leg) · **Ferry** · Dep/Arr **FBO** (`FboPicker`).
- Each row shows live **flight time + ETA** via `useLegEstimate` → `/leg-estimate`
  (`≈ nm · h:mm ETE`, ETA under the To airport). This is the working engine — it just wasn't
  rendered on the edit surface before.
- **"+ Add leg"** appends a blank leg; per-row **✕** deletes (disabled when one leg remains).
  No modal.

**Client info (editable):**
- Company + contact (name / email / phone), editable inline, company autocomplete from prior
  trips (`distinctClients`). Persisted via the extended `/details` endpoint (§6).

**Pricing — compact, auto + light controls:**
- Live total driven by the rate card (`useQuotePreview` while editing; persisted by autosave).
- Controls: **rate card** (via tail+purpose), **ad-hoc fees** (`feeCatalog`: catering /
  hotels / de-ice / …, each `{code, description, amount, taxable}`), and a **total override**.
- Reuses `frontend/src/lib/feesMath.js` `recomputeInputs` for the live on-screen total and
  persists via `PATCH /trips/:id/price-lines` — keeping the frontend↔backend pricing in
  lockstep (golden rule). The page does **not** reimplement `priceTrip`.

**Actions:**
- *View Quote ↗* (`/quote/:id`), *Quote PDF ↗* (`/quote/:id/pdf`), *Copy client link* — the
  existing buttons, unchanged renderer/format.
- **Book** → `PATCH /trips/:id {status:'booked'}` (assigns Trip # + booked_by/at), then
  navigate to `/scheduling/trips/:tripNo`.
- **Discard** (draft only) → `DELETE /trips/:id`.
- **Saving… / Saved ✓** indicator (autosave state, §5).

**Components:** `QuoteEditor` (page), reused `LegRow`/`LegSummary`/`useLegEstimate`/
`useQuotePreview`/`FboPicker`/`AirportInput`, new `QuotePricingPanel` (slim fees), new
`ClientInfoFields`, new `SaveIndicator`.

---

## 5. Autosave

- **Debounced** (~600–800 ms after the last change). Two save paths, each updates the
  indicator:
  - Leg / aircraft / purpose / client changes → `PATCH /trips/:id/details` (recomputes base
    pricing from the rate card).
  - Pricing-control changes (rate card, ad-hoc fees, override) → `PATCH /trips/:id/price-lines`.
- **Reprice must not clobber manual edits:** a `/details` save recomputes the *base* lines but
  **preserves** `fees[]`, `fetEnabled`, and `totalOverride` (override still wins). Only an
  explicit "Re-price / reset" clears the override (matches the established Fees behavior).
- **Ordering / staleness:** saves are issued sequentially per path; ignore a response that is
  no longer the latest in-flight request (guard against out-of-order writes). On failure, the
  indicator shows "Save failed — retry" and the local edit is retained.
- Live total uses local `feesMath` so the number updates instantly without waiting on the save.

---

## 6. Backend changes (small, additive — no migration)

In `routes/scheduling.js`:
1. **Number resolution** — `GET /quotes/:quoteNumber` and number-aware `GET /trips/:id`
   (§3). TEXT comparison on the numbers (provisional, TEXT columns).
2. **Editable client info** — extend `PATCH /trips/:id/details` to accept and persist
   `company_name` and `contact` (jsonb `{name,email,phone}`). Today it only edits
   aircraft/customer/legs.
3. **Reprice preservation** — ensure the `/details` reprice path (`priceAndStore`) merges
   rather than wipes existing `pricing.fees` / `fetEnabled` / `totalOverride` (§5).

Unchanged and reused: `POST /trips` (create + quote#), `PATCH /trips/:id` (book → trip#),
`POST /quote-preview`, `PATCH /trips/:id/price-lines`, `GET /leg-estimate`, public
`/quote/:id` (+`/pdf`/`/accept`).

---

## 7. Create flow

- The Scheduling hub "New Quote" (and `/scheduling/new`) **creates a draft immediately**:
  `POST /trips` with the default tail + one blank leg + `status='quote'` → assigns
  `quote_number` + uuid → redirect to `/scheduling/quotes/:quoteNo`.
- Editing is then in-place with autosave. **Discard** deletes an abandoned draft.
- *Draft litter* (quotes created and never filled) is mitigated by Discard; a future
  background sweep of stale empty drafts is an open item, not in this scope.

---

## 8. Lifecycle, numbering & cross-links

- Lifecycle unchanged: `quote → booked → released → closed`, `cancelled` until closed
  (`scheduling/workflow.js`). **Quote #** at create, **Trip #** + `booked_by`/`booked_at` at
  Book. Numbering is provisional/TEXT, max computed in JS (final scheme deferred to LF cutoff).
- **Cross-links:** quote editor → "Booked as Trip N →"; trip page → "← Quote N". Both derive
  from the single row's `quote_number`/`trip_number`.

---

## 9. Testing

All `node:test` (repo convention).
- **Backend units** — number resolution (`GET /quotes/:n`, number-vs-uuid `GET /trips/:id`,
  TEXT compare, not-found); `/details` persists `company_name`/`contact`; `/details` reprice
  **preserves** `fees[]`/`fetEnabled`/`totalOverride`.
- **Frontend** — `feesMath.recomputeInputs` mirror still matches backend (existing test);
  `cd frontend && npm run build` check.

---

## 10. Edge cases & error handling

- **Booked quote URL** → read-only summary + send + trip link (shared row).
- **Quote-status hit on the trip URL** → redirect to the quote editor.
- **Autosave races** → sequential per path, ignore stale responses, retain local on failure.
- **Reprice vs override** → leg edits preserve ad-hoc fees + override; explicit Re-price
  clears the override only.
- **Number collisions** (provisional numbering) → resolver picks deterministically (most
  recent) and logs; final scheme is the LF-cutoff project's concern.
- **Draft litter** → Discard; future stale-draft sweep noted as open item.
- Stores already **soft-fail** on missing columns; no migration required here.

---

## 11. Documentation (apply during implementation)

Per the standing rule, update `CLAUDE.md` in the same change: §19 (new `GET /quotes/:n`,
number-aware `GET /trips/:id`, `/details` now edits client info), §20 (new
`/scheduling/quotes/:quoteNo` route, trip route keyed by trip_number, `SchedulingNewTrip`
→ `QuoteEditor`), and §2 (mark this work in flight / done).

---

## 12. Open items

- Final Quote#/Trip# numbering + uniqueness guarantees (LF-cutoff project).
- Background sweep of abandoned draft quotes.
- Whether the post-booking quote URL should ever be fully hidden vs. the read-only summary.
