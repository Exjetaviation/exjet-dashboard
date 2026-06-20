# LevelFlight UI Replica — Design Spec

**Date:** 2026-06-20
**Status:** Approved (design); ready for implementation plan
**Context:** Part of the LevelFlight scheduling rebuild. Goal: a **breadth-first** replica of LevelFlight's whole scheduling UI inside the existing Scheduling section, in the dashboard's design language, so the user can navigate the full system, see how the screens connect, and triage what to keep / cut / deepen.

---

## Goal

Stand up **every LevelFlight scheduling screen**, present and navigable, wired together, in one push. Real data from the mirror where we have it; honest empty-states where we don't. Deepest on the Trip detail screen (the one the user praised). This is a *triage scaffold*, not a final product — we deepen keepers and delete the rest afterward.

## Non-goals (this phase)

- Pixel-perfect fidelity of every screen (we ground per-screen later, as the user triages).
- New write/mutation flows beyond what already exists (status workflow, quote create). These screens are **read/visualize-first**; creation/editing deepens later.
- New backend data pipelines. Screens aggregate the **existing** `/api/scheduling/legs` (+ `/trips/:id`) client-side. No migrations.

## Architecture

The Scheduling section (already its own top-level page with a sub-nav) gains a **LevelFlight-style sub-nav**. Each entry is a self-contained page component under `frontend/src/pages/scheduling/`. All read from the existing endpoints; aggregation (crew/aircraft/clients/overview) happens **client-side** from the legs payload (each leg snapshot already carries `dispatch.aircraft`, `dispatch.client`, `pilots`, `attendants`, `passengerCount`, `checklist`, `_calc`, etc.).

### Sub-nav (the screens)

| Screen | Source | Depth this phase |
|---|---|---|
| **Overview** | aggregate `/api/scheduling/legs` | counts (trips by stage, flights today/this week), next departures, alerts |
| **Schedule** | existing board | already built — keep |
| **Trips** | existing list | already built — keep |
| **Quotes** | existing | already built — keep |
| **Requests** | none yet | LevelFlight layout + empty-state ("no request feed connected") |
| **Crew** | leg `pilots`/`attendants` | roster derived from assignments; per-crew upcoming legs |
| **Aircraft** | leg `dispatch.aircraft` | fleet list + each tail's status/next leg |
| **Clients** | leg `dispatch.client.company` | customer list + each client's trips |

### Trip detail / builder (the deep screen)

Expand `SchedulingTripDetail` into LevelFlight's full layout, all from the legs the `GET /trips/:id` already returns:
- **Header + action panel** — route/title, status workflow buttons (exist), Itinerary / Trip Sheet (exist), placeholders for Quote / Send-to-QB.
- **Legs** — per leg: route, dep/arr times, distance + EFT (`_calc`), FBOs, crew (seat 2 PIC / 3 SIC / 5 attendant → `user.firstName/lastName`), pax count.
- **Crew** — consolidated crew for the trip.
- **Passengers** — pax count / manifest if present.
- **Trip Checklist** — Contract / Payment received / Processed (from leg `checklist` where present; read-only display this phase).
- **Pricing** — the breakdown card (exists).
- **Documents** — Itinerary + Trip Sheet links (exist).
- **History** — provenance (origin, locally_modified, modified_by/at).

### How it works together (the thread)

**Request → Quote → Book → Trip → Release → Trip Sheet/Itinerary → (QuickBooks).** The Trip is the spine; Overview / Schedule / Crew / Aircraft / Clients are lenses onto the same trips. Cross-links: Crew/Aircraft/Client rows link to the relevant trips; trip detail links back to the aircraft/client.

## Components / file structure

- `frontend/src/pages/Scheduling.jsx` — extend the sub-nav to the full set; route to the new pages.
- `frontend/src/pages/scheduling/Overview.jsx`, `Requests.jsx`, `Crew.jsx`, `Aircraft.jsx`, `Clients.jsx` — new screens (each focused, < ~200 lines, dashboard-styled).
- `frontend/src/lib/schedulingAggregate.js` — pure helpers that derive crew/aircraft/client/overview rollups from a legs array (unit-testable, no I/O).
- `frontend/src/pages/SchedulingTripDetail.jsx` — deepen into the sectioned layout above.
- Reuse existing components (FlightsList, Calendar, TripSheetActions) and CSS-var styling.

## Data flow

`useApi('/api/scheduling/legs')` → legs[] (each with full snapshot) → `schedulingAggregate` rollups → screen render. Trip detail uses `GET /api/scheduling/trips/:id` (trip + legs). No backend changes.

## Error handling

Every screen handles loading / error / empty independently (the legs endpoint already returns `{legs:[],error}`). Stub screens (Requests) show a clear "not connected yet" empty-state, never a broken UI. Missing snapshot fields render as "—".

## Testing

- `schedulingAggregate.js` pure rollups unit-tested (`node --test`, e.g. distinct-crew, distinct-aircraft, client-trip grouping, overview counts) against a small fixture of leg snapshots.
- Each frontend screen verified by `npm run build` (project convention — no component tests).

## Out of scope / next

- Deepening keepers (real creation/edit flows, pixel-faithful per-screen passes with a LevelFlight walkthrough).
- Requests data feed, crew duty/rest rules, maintenance status — wired when the data source exists.
