# Scheduling Core + Dispatcher Web — Design

**Date:** 2026-06-18
**Status:** Approved (brainstorm) — pending implementation plan
**Owner:** Jaime Torres / Exjet Aviation

---

## 1. Background & program context

Exjet's dispatch dashboard (`exjet-dashboard`) currently pulls operational data from three external systems: **LevelFlight** (scheduling/dispatch), **ForeFlight** (flight data), and **QuickBooks** (accounting). The goal of the broader program is to **replace LevelFlight's scheduling** with software Exjet owns — while **keeping QuickBooks**, ForeFlight, and Avinode.

The full program is five subsystems, to be built as separate design→plan→build cycles:

1. **Scheduling core + dispatcher web** ← *this spec*
2. Slack notifications
3. Pilot app (App Store)
4. Client app (App Store)
5. Dispatcher mobile app (App Store)

This document designs **only sub-project #1**. The others are out of scope here but are kept in mind so the data model and API don't paint us into a corner. (`backend/agent` "Operations Copilot" capability map is **abandoned** and unrelated.)

## 2. Goal & scope

Build a new **Scheduling** section *inside* the existing `exjet-dashboard` (additive — the current dashboard keeps working untouched) that replaces LevelFlight's scheduling with the **same functionality, a simpler UI, and full create/edit capability**.

**In scope:** the scheduling data model, a one-way sync from LevelFlight, the dispatcher web UI (Schedule board, Trips list + trip builder, Requests), the backend API, and the supporting error-handling/testing.

**Out of scope (separate cycles):** the three mobile apps, Slack notifications, replacing QuickBooks/maintenance/manuals/compliance/financials (those stay in LevelFlight).

### Design principles
- **"Same bones, better skin."** Keep all of LevelFlight's scheduling capability; redesign the UX. LevelFlight's UI is hard to learn and fragmented across ~8 scheduling screens; the new one is consolidated and matches the existing dashboard's dark look.
- **Expandable and easy to edit.** Modular structure, small well-bounded components, clean API boundary.
- **Reuse the dashboard's skin.** Calendars, trip lists, legs lists, and the fleet map must look/behave exactly like the existing dashboard components — not LevelFlight's. What we copy *from* LevelFlight is the **depth of the trip detail** and the **editing functions**.

## 3. Transition strategy

**Independent parallel build with one-way read sync, then a hard cutover.** We never write to LevelFlight.

- **Phase 1 (now → cutoff):** LevelFlight stays the operational source of truth (real ops + QuickBooks/compliance/Pilot-app/Avinode continue there). The new system continuously **reads/mirrors** from LevelFlight and is **fully independent** — dispatchers can create and edit in it with **zero effect on LevelFlight** (a real, usable parallel system to build trust).
- **Cutover (a chosen date):** one final full sync → reconciliation report → flip source of truth.
- **Phase 2 (after):** LevelFlight scheduling retired; the new system is the sole source of truth; sync stops.

This deliberately removes the riskiest dependency: we never need LevelFlight's write API.

## 4. Architecture (Approach C)

A new **self-contained `scheduling/` module** within the existing monorepo:

- **Frontend:** new route namespace (e.g. `/scheduling/*`) and components, added alongside today's pages. A few existing dashboard components (calendar/board, trips list, legs list, fleet map) are **lifted into a shared location** so both the old pages and the new section import the *same* components — they stay visually identical and bugs are fixed once.
- **Backend:** new route files under `/api/scheduling/*` + dedicated service modules (thin routes, logic in services — matching the existing `routes/` + `services/` pattern).
- **Data:** a new Supabase schema for scheduling, plus the existing mirrored tables (extended).
- **Sync:** a background worker (evolved from `exjet-ingest`).

The module's API is the clean boundary the future apps will reuse. Cost: a small upfront refactor to extract the shared components.

## 5. Data model & provenance

Two layers:

**Reference layer (mirrored from LevelFlight, shared foundation):** aircraft (seats, cruise speed, fuel burn, rate tables), crew (quals, type ratings, currency), customers/companies, airports/FBOs. Most already exist via `exjet-ingest`.

**Operational layer (mirrored OR created-here):**
- **Trip** — *one object* across its lifecycle, with a `status` of `quote | hold | booked | cancelled` (not separate quote/dispatch tables). References a customer, aircraft, and rate; holds the pricing breakdown.
- **Leg** — belongs to a trip: from/to airport, local + Zulu times, FBO each end, runway/elevation, per-leg ops checklist.
- **Crew assignment** — per leg: PIC / SIC / attendant → references mirrored crew.
- **Passenger** — per trip/leg: TSA status, name, DOB, weight, cargo, notes.

**Provenance & edit model (every operational record):**
- `origin`: `levelflight | native`
- `lf_oid`: LevelFlight ObjectId (null for native)
- `lf_synced_snapshot` (jsonb): frozen copy of LevelFlight's version
- `locally_modified` (bool), `modified_by`, `modified_at`
- `upstream_changed` (bool): set when LevelFlight changes a record the user has locally modified

**Everything is editable before cutover.** Editing a mirrored record writes to its **working copy** and sets `locally_modified` — LevelFlight is never touched. A **"Revert to LevelFlight"** action copies the snapshot back over the working copy and clears the flag. Native records have no snapshot (nothing to revert). Native records reference mirrored data by stable `lf_oid`.

## 6. Sync engine

Evolves `exjet-ingest` from a manual monthly script into a scheduled background worker (runs alongside the Express backend on Railway). LevelFlight → Supabase only.

1. **Connector** — reuses the Cognito refresh-token auth, retry/backoff, and 500-row chunking from `exjet-ingest`.
2. **Scheduled jobs by cadence** — reference data ~hourly; operational data (trips/legs/crew/pax) **every few minutes** over a rolling **−30 to +90 day** window; Avinode requests frequently. LevelFlight exposes no webhook, so we poll with bounded date windows.
3. **Reconcile engine** (per record, matched by `lf_oid`): always refresh `lf_synced_snapshot` + `synced_at`; if `locally_modified = false`, update the working copy (normal mirror); if `locally_modified = true`, leave the working copy and set `upstream_changed` if the snapshot changed; insert new records as `origin = levelflight`. Idempotent upserts.
4. **Supabase** → a **`sync_status`** table → UI freshness indicator ("Synced 2 min ago ✓", degrading to a warning when stale).

The same connector performs the **cutover migration** (one final full sync, then stop).

## 7. Information architecture (the UI)

The new Scheduling section consolidates LevelFlight's ~8 scheduling screens into **3 views**:

- **📅 Schedule** — one board with a **By Aircraft ⇄ By Crew** toggle (replaces LevelFlight's two calendars). Reuses the dashboard's calendar/board component. Can use **Supabase Realtime** for live updates.
- **✈️ Trips** — **one filterable list** where `quote/hold/booked/cancelled` is a *status filter* (replaces LevelFlight's separate tabs). Reuses the dashboard's list components. Opens the trip builder.
- **📥 Requests** — Avinode RFQ intake (its own view), turning inbound RFQs into quotes.

### Trip builder (the key redesign)
A **blended** layout that fixes LevelFlight's endless single-scroll:
- **Persistent trip header**: Trip/Quote #, status pill, provenance badge + **⟲ Revert**, and actions (View Quote / Itinerary / Crew Trip Sheet / Invoice).
- **Sectioned left nav**: Overview · Legs · Crew · Passengers · Pricing · Checklist · Documents — one focused thing on screen at a time.
- **Legs section = itinerary timeline**: legs stack; click one to **expand inline** (airports with autocomplete, local + Zulu times, FBO each end, crew & pax for that leg), with the **per-leg ops checklist collapsed behind a toggle**. Route map reuses the dashboard component.
- The checklist appears both per-leg (collapsed) and as its own trip-level section.

## 8. Backend API

Namespace `/api/scheduling/*`, own route files + services. Plain REST so any client can reuse it.

- **Trips** — list (filters: status, date window, aircraft, crew, customer), get detail, create, update, change-status, cancel
- **Legs** — nested under a trip: add, update, reorder, remove
- **Crew assignments** — assign/unassign per leg
- **Passengers** — add/update/remove
- **Pricing** — price a trip from rate tables + FET/crew/fuel toggles
- **Reference reads** — aircraft, crew, customers, companies, airports/FBOs, rates (from the mirror)
- **Revert** — restore a record to its LevelFlight snapshot
- **Sync status** — freshness

**Auth & roles:** reuses the dashboard's Supabase auth (ES256, verified via `supabase.auth.getUser`), role-aware from day one (**Scheduler**, **Ops Control**). **Documents stay backend-rendered** (finished HTML/PDF). Provenance and edit rules are enforced server-side.

**Decision:** keep the API **strictly scheduling-web for now** — no app-specific concerns (push, offline). Clean REST stays reusable when the apps are built.

## 9. Error handling & edge cases

- **Sync resilience:** per-entity isolation (one job failing doesn't poison others); idempotent upserts + retry/backoff; on failure keep last-good data and show a stale warning; LevelFlight token expiry → Cognito refresh, else mark sync degraded.
- **Edit/provenance:** `upstream_changed` is surfaced as "LevelFlight changed this — review or revert," never silently overwritten. Server-side validation on trips/legs (required fields, valid airport codes, leg time ordering, referenced aircraft/crew exist).
- **Cutover safety:** final full sync → reconciliation report (counts, `locally_modified`/`upstream_changed` conflicts) → then flip; re-runnable, non-destructive until confirmed.

## 10. Testing

- **Reconcile engine** gets the most tests (riskiest logic): locally-modified protection, snapshot refresh, insert vs update, conflict flagging — with mocked LevelFlight responses.
- **Pricing engine** unit-tested against known quotes.
- **Trip/leg CRUD + provenance** integration tests.
- **Mirror-fidelity check** sampling mirrored records against LevelFlight before cutover.
- Uses the existing `node:test` backend setup and the repo's frontend test setup.

## 11. Build sequence

1. **Slice 1 — Foundation + Read** (ships first, zero risk): one-way sync + Schedule board (read) + Trips list/detail (read). Proves the mirror and the consolidated UI without touching anything live.
2. **Slice 2 — Trip builder** (fixes the #1 pain): native create/edit of trips, legs, crew, passengers, with provenance + revert.
3. **Slice 3 — Quoting + Requests**: pricing engine + Avinode RFQ intake.
4. **Cutover prep**: full migration, reconciliation, flip source of truth, retire LevelFlight scheduling.

(Then, as separate program cycles: Slack notifications, pilot/client/dispatcher apps.)

## 12. Reference

- LevelFlight API spec: `~/Downloads/swagger-docs.yaml` (104 endpoints; base `https://rest.levelflight.com/{stage}`; Cognito JWT; EJSON `$oid`).
- Existing mirror/ETL: `~/exjet-ingest` (LevelFlight → Supabase: aircraft, crew, legs, duty_periods).
- Existing dashboard components to share: calendar (`Calendar.jsx`, `CrewCalendar.jsx`), lists (`Flights.jsx`, `TripsList.jsx`), map (`Map.jsx`, `FlightTrackMap.jsx`, `TripPathMap.jsx`).
