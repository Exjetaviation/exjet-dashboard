# Exjet Dashboard — Project Guide for Claude Code

> **Read this first.** This is the deep reference for `exjet-dashboard`, Exjet Aviation's internal
> operations dashboard. The headline initiative is **rebuilding LevelFlight's scheduling/quoting as
> Exjet's own software inside this repo.**
>
> **How to use this doc:** §1–§4 + §17 + §24 are the must-reads (what this is, current focus, stack,
> the domain model, the background workers, and the golden rules). The per-subsystem sections (§5–§16)
> and the catalogs (§18 schema, §19 routes, §20 frontend, §21 env, §22 scripts) are reference-on-demand
> — jump to the one you're touching. Deeper design write-ups live in `docs/superpowers/{specs,plans}/`.

> **⚠️ KEEP THIS FILE CURRENT — this is a standing instruction for every agent.**
> This guide is the single source of truth for how the project works, so it must not drift from the code.
> **Whenever your change alters something this file describes, update the relevant section in the SAME change** —
> for example: adding/renaming/removing a route, table, column, migration, env var, background worker, page,
> or script; shipping or retiring a feature; changing a convention or invariant; or applying a migration
> (move it from "in flight" to applied). Match the existing style (dense bullets/tables; flag gotchas
> explicitly). If you discover a fact here is wrong or stale, **fix it here too** — don't just work around it.
> An out-of-date CLAUDE.md silently misleads every future agent.

---

## Table of contents
1. What this is
2. Current focus & what's in flight
3. Stack, deployment & how it runs
4. Core domain model (the leg, native-vs-mirror, lifecycle, addressing, the invariants)
5. LevelFlight integration & the 5-minute sync
6. Scheduling core (native trips/legs, mappers, reference data, people/crew)
7. Quoting, pricing & rate cards
8. Backend-rendered documents (quote / itinerary / trip sheet)
9. ADS-B tracking & the calendar actual-times overlay
10. Fuel-price ingestion
11. Slack per-trip channels
12. Finances / QuickBooks
13. ForeFlight briefings
14. AI agent ("Operations Copilot") + manuals RAG + NTSB  (+ legacy assistant)
15. Maintenance
16. Auth & security model
17. Background workers (summary)
18. Database schema (table catalog)
19. HTTP API surface (route catalog)
20. Frontend (React + Vite)
21. Environment variables
22. Operational scripts
23. Testing
24. Conventions & gotchas — the golden rules
25. Repository map

---

## 1. What this is

`exjet-dashboard` is the internal ops dashboard for **Exjet Aviation, a Part 135 charter operator
flying two Gulfstream GIV-SP aircraft, `N69FP` and `N408JS`** (15 pax each). It is the cockpit for
dispatchers, the Director of Operations, and accounting.

**The headline initiative:** rebuild LevelFlight's (LF) scheduling + quoting + dispatch as **Exjet's
own native software** inside this repo, so Exjet owns the scheduling UX and logic — heading toward an
eventual **"LF cutover"** where new business never needs to live in LF.
- **LevelFlight (LF)** remains the upstream **source of truth** for flights/dispatches/legs/customers.
  We pull it via the LF API and mirror it into Supabase. Sync is **one-way (LF → mirror only)** — we
  never write back to LF.
- **Native trips/quotes** are increasingly created in our own DB (`origin='native'`) and never touch LF.
- **QuickBooks is explicitly KEPT** — finances are not being replaced.

The repo also contains supporting subsystems: live ADS-B fleet tracking + a scheduled-vs-actual
calendar, backend-rendered branded documents (quote/itinerary/trip-sheet HTML+PDF), fuel-price
ingestion, Slack per-trip channels, a QuickBooks finance dashboard, ForeFlight briefings, and an AI
"Operations Copilot" agent (RAG over the GOM manual + NTSB accident history).

> **Note — base location:** the fleet is two GIV-SPs; the operating base appears as **Fort Lauderdale
> (KFXE)** in some surfaces and **Orlando** in the AI agent's system prompt. Treat as unverified if it
> ever matters operationally.

---

## 2. Current focus & what's in flight

The active thrust is the **Quoting → Dispatch revamp** (LF-parity native quote→book→release→close
flow that we fully own) plus the supporting ops features below. Recent/active work (see §25 for branches):

- **Just merged to `main`:** fuel-price email ingestion (WFS + Everest vendor CSVs → `fuel_prices` +
  a Fuel admin tab). Calendar "simulate fleet" demo + always-on NOW pill.
- **Uncommitted in the working tree (on `main`):** `adsbRecorder.js` / `adsbTrack.js` — **firehose-based
  departure recovery** so a server that boots mid-flight (or a plane picked up mid-climb) recovers
  `actual_dep` from the persisted track instead of stamping a late "now". See §9.
- **Awaiting rollout (opt-in, dark until enabled):**
  - **Slack per-trip channels** (§11) — needs migration `020` applied, a Slack app + `SLACK_BOT_TOKEN`
    + member-group env vars on Railway, and `SLACK_TRIP_CHANNELS=on`.
  - **Fuel ingestion** (§10) — needs migration `021` applied, `GMAIL_OPS_*` set on Railway, and
    `FUEL_MAIL_SCAN=on` for the weekly worker (the manual `POST /api/fuel/scan` works once `GMAIL_OPS_*` is set).
- **Open feature branches:** ADS-B live tracking, force-dark-theme, calendar airborne-border, map
  fullscreen, dark-map-background fixes, and `chore/remove-old-assistant-widget` (retiring the legacy
  `/api/assistant`, §14).
- **Shipped on `feat/quote-editor-trip-split`:** quote/trip page split — a streamlined Quote editor
  keyed by Quote # (`/scheduling/quotes/:quoteNo` → `QuoteEditor.jsx`) vs the booked Trip page keyed
  by Trip # (`/scheduling/trips/:tripNo` → `SchedulingTripDetail.jsx`); both backed by one
  `scheduling_trips` row; no migration. New backend: `GET /api/scheduling/quotes/:quoteNumber`,
  trip_number read support in `GET /trips/:id`, `repriceFromBase` preserves manual overrides.
- **Shipped on `feat/pricing-slideout`:** Pricing tab + slide-out — per-line `overrides` (pins),
  `costPerHr`/`posRate`/`effectiveHourly`, `computeFlightCost`, Recalculate reset (`POST /price`);
  shared `PricingSummary`/`PricingSlideOut` components used by both Quote editor and Trip page; Fees
  tab renamed "Pricing" (tab `id` still `fees`).
- **Roadmap / open items for the LF cutover** (from `docs/superpowers/specs/2026-06-22-quoting-dispatch-revamp-design.md`):
  final Quote#/Trip# numbering scheme, whether native dispatches ever sync back to LF, TSA Secure
  Flight filing, Payments/QuickBooks push, and a future **"true cost-per-hour" quoting** project that
  the fuel-price data feeds.

---

## 3. Stack, deployment & how it runs

| | Backend | Frontend |
|---|---|---|
| **Lang/runtime** | Node ≥ 20.12, ESM (`"type":"module"`) | React 19, Vite 8, no TypeScript |
| **Framework** | Express | React Router 7 |
| **Location** | `backend/` (entry `backend/src/index.js`) | `frontend/` (entry `frontend/src/main.jsx` → `App.jsx`) |
| **Data** | Supabase (Postgres + Storage + Auth) via `@supabase/supabase-js` | Supabase JS (browser auth only) |
| **Deploy** | **Railway**, auto-deploys on push to `main` (`railway.toml`: nixpacks, `npm start`) | **Vercel**, auto-deploys on push to `main` (`vercel.json`: SPA rewrite) |
| **Dev** | `cd backend && npm run dev` (nodemon) \| `npm start` | `cd frontend && npm run dev` \| `npm run build` |

- **Backend boot** (`index.js`): loads the QB refresh token from Supabase (see §12), mounts public +
  guarded routers, then on `listen` starts **five background workers** (§17).
- **Notable deps:** `@anthropic-ai/sdk` (agent), `puppeteer-core` + `@sparticuz/chromium` (server-side
  PDF), `googleapis` (Gmail), `intuit-oauth` (QuickBooks), `papaparse` (fuel/NTSB CSV), `pdf-parse`
  (manual ingest + ForeFlight PDFs), `simple-statistics` (perf calibration), `axios`. Frontend: `leaflet`
  + `react-leaflet` (maps), `react-markdown` + `remark-gfm`.
- **CORS** is locked to `http://localhost:5173` and `https://exjet-dashboard.vercel.app`.

### Migrations — applied MANUALLY
Numbered SQL in `backend/migrations/` (**`001` … `022`**, latest `022_fleet.sql`). There is **no
migration runner and no `psql`/DDL access** — Claude only has the Supabase PostgREST client (service
key). **Migrations are applied by hand in the Supabase SQL editor.** Every migration is idempotent
(`IF NOT EXISTS` guards). After writing one, **ask the user to run it.** Stores are written to
**soft-fail** when a table/column is absent, so code can deploy before its migration is applied.
The latest migrations gate in-flight features: `018` quoting revamp, `019` quote-accept, `020` Slack,
`021` fuel, `022` fleet (aircraft profiles + components + time ledger + flight info).

---

## 4. Core domain model

Everything centers on the LevelFlight **leg**. Understand this shape and the native-vs-mirror split
before touching scheduling/quoting/calendar code.

### The LevelFlight "leg" shape
- **`_id.$oid`** — the **leg id, the canonical key** across the whole app. Calendar blocks, actuals,
  flight tracks, and document VMs all key off it. (LF objects are EJSON — ids arrive as `{$oid}` /
  string / number; normalize with `oidToStr`.)
- **`departure` / `arrival`** = `{ airport (ICAO), time (SCHEDULED epoch ms), fbo {...} }`.
- **`dispatch`** = `{ _id.$oid, tripId (human trip #), aircraft.tailNumber, aircraft.type.name,
  client {company, customer} }` — the parent trip.
- **`pilots: [{user, seat}]`**, **`attendants: [{user, seat}]`** — crew. **Seat convention: 2 = PIC,
  3 = SIC, 7 = cabin/FA.**
- **`passengers: [{user, seat}]`** = the ASSIGNED pax. **Pax count = `passengers.length`** (via
  `services/paxCount.js` → `assignedPaxCount`), **NOT** the separate `passengerCount` field (the two
  disagree, e.g. 15 vs 13). The sync mapper rewrites `snapshot.passengerCount` to the assigned count.
- **`status`** — `0` Scheduled / `1` Active / `2` Booked/Completed / `3` Completed / `4` Released
  (codes vary by context; `workflow.js` normalizes them).
- **`_calc`** — computed: `distance{value}`, `minutes`, `time` (eft), `from`/`to`
  `{ name, location{lat,lng}, timezone, comms, runways, elevation }`.
- **`block = {out, off, on, in}`** — **CREW-ENTERED OOOI actual times** (epoch ms), present once pilots
  log post-flight. `out`→actual dep, `in`→actual arr. **This is the most authoritative actual-times
  source** (there is no other actuals field in the LF API). Rides along in `getScheduledLegs`.

### Lead passenger
LF has **no explicit "lead passenger" field** — the lead manifests as the **SEAT**: the lead holds the
unique lowest (forward) seat; others share a default seat. `services/leadPassenger.js` →
`leadUserId(passengers)` returns the single passenger with the unique min seat (null on tie/none). The
itinerary + trip sheet show the lead first / highlighted.

### Native vs mirror — the `origin` column
Native and mirrored trips live **in the same tables**, distinguished by **`origin`** (`'native'` vs
`'levelflight'`). This gates behavior **everywhere**:
- Only **`native`** trips can be edited-in-detail or deleted; mirrored trips are read-only LF snapshots
  that can only be **status-overridden locally** (sets `locally_modified=true`) or **reverted**.
- `buildNativeLeg.js` synthesizes an **LF-shaped snapshot** for each native leg (synthetic
  `_id.$oid = "${trip.id}:${seq}"`) so native and mirrored legs render through the *same* components.
- A trip is addressed by **`lf_oid` (24-char hex)** for mirrored or **`id` (uuid)** for native;
  `tripColumn`/`UUID_RE` picks the column. **Document routes fork on id shape: uuid → native VM,
  24-hex → LF VM** (applies to `/quote/:id`, `/itinerary/:id`, trip-sheet).

### Trip lifecycle & numbering (`scheduling/workflow.js`, `numbering.js`)
- Stages: **`quote → booked → released → (auto) closed`**, with **`cancelled`** available until closed.
  `TRANSITIONS` enforce legal moves (illegal → HTTP 409). **There is no manual Close** — release
  auto-closes once all legs have arrived (`autoClose`, guarded strictly on the literal `'released'`).
- **Numbering is provisional** (final scheme deferred to the LF cutover). Stored as **TEXT**; the max
  is computed **in JS** (a SQL `ORDER BY` sorts lexically and picks the wrong max). `nextQuoteNumber()`
  base **3000** (assigned at native create); `nextTripNumber()` base **26000** (assigned once on first
  transition to `booked`, alongside `booked_by`/`booked_at`).

### Time normalization (a recurring footgun)
LF sends mixed timestamps (epoch ms / epoch sec / ISO / Date). **Native legs store `departure.time` as
epoch ms; mirrored LF legs store ISO strings.** Any code touching leg times must normalize (see
`lfNormalize.toIsoTimestamp`, and `toMs` in routes).

---

## 5. LevelFlight integration & the 5-minute sync

**Client:** `backend/src/services/levelflight.js`. Auth = OAuth2 **refresh-token grant** → the response's
**`id_token`** is the bearer (NOT `access_token`); in-memory cache with a 60s safety margin. All calls
go through an `axios` instance at `LEVELFLIGHT_BASE_URL`.

Key calls (method + LF endpoint):
- `getScheduledLegs(monthAnchorMs)` → `POST /api/analytics/scheduledLegs {start}` — **one month per
  call**; carries the `block` OOOI actuals. The core sync input.
- `getTripLog(dispatchOid)` → `GET /api/dispatch/{id}/flightLog` — full legs (crew/FBO/coords); the
  **itinerary** source.
- `getDispatchRelease(oid)` → `GET /api/dispatch/{id}/release` — rich `{operation, aircraft, releases,
  pax, employees, mx, …}`; the **trip-sheet** source.
- `getCustomer(id)`, `getAllCustomers()` (1h cache) / `getAllCustomersRaw()`, `getImageUrl(imageId)`
  (presigned S3 for doc scans), `getAircraft()`, `getPilotsList()`/`getAttendants()`/`getUsers()`,
  `getAircraftCalendar()` (work orders), `getPilotCalendar()`, `getDispatchList()`, `getAirportFbos(icao)`.
- **GOTCHA: raw `GET /api/dispatch/{id}` 404s — only `/flightLog` and `/release` work.** Customer path is
  slash-delimited `/api/customer/list/{letter}/{page}` (not the hyphenated swagger form). No retry layer here.

> **Two LF clients exist.** The production path is `services/levelflight.js`. The AI agent uses a separate
> thin client `agent/providers/levelflight.js` (native `fetch`, different base-URL handling — appends
> `/prod`, defaults `https://rest.levelflight.com` — JWT-`exp`-aware cache, different endpoint paths e.g.
> `/api/aircraft/list` vs `/all`). **Edit the right one.**

### The 5-minute sync — `scheduling/syncWorker.js` → `runScheduledLegsSync.js`
- **Opt-in:** no-op unless `SCHEDULING_SYNC === 'on'`. Runs immediately, then every **5 min**.
- **Window:** `computeMonthStarts(now, {backDays:30, fwdDays:90})` → ~5 monthly buckets; fetch each,
  concatenate, `mapScheduledLegs` → `{trips, legs, crew}` (deduped by `lf_oid`).
- **Writes parent-before-child** (trips → legs → crew) so FKs resolve; children whose parent didn't
  resolve are dropped. `seq` recomputed by sorting legs on `dep_time`.
- **`locally_modified` protection (the central correctness invariant):** for existing rows, **insert new
  rows in bulk but UPDATE existing rows ONE AT A TIME** with `.update(patch).eq('lf_oid')`. A single
  heterogeneous PostgREST upsert would union keys across the batch and NULL-fill omitted ones on
  conflict — clobbering a locally-modified row's deliberately-omitted working columns and crashing on
  `NOT NULL` (e.g. `legs.trip_id`). A `locally_modified` row is **sacred**: reconcile only refreshes its
  `lf_synced_snapshot`, bumps `synced_at`, and sets a sticky `upstream_changed` flag (so the UI can offer
  "Revert"). See `scheduling/syncDb.js`, `reconcile.js`, `reconcileBatch.js`.
- **Side jobs** (each best-effort, `.catch`): `autoCloseCompletedTrips`, `calibratePerfProfiles`,
  warm `getAllCustomers`, and `syncLfDirectory()` (incremental people import → enrich → link, see §6).

---

## 6. Scheduling core

Code in `backend/src/scheduling/` (32 `*.test.js` files — the most-tested surface). HTTP surface:
`routes/scheduling.js` (mounted `/api/scheduling`, mutating routes gated by `requireSchedulingEditor`).

- **Mappers / normalization** (all pure, unit-tested): `lfNormalize.js` (`oidToStr`, `toIsoTimestamp`,
  `unwrapArray`), `mapScheduledLegs.js` (the core LF→entities transform), `mirrorLegs.js`
  (`mirrorLegsFromRows` — what the read UI consumes; rows without a snapshot are dropped), `attachFk.js`
  (inject resolved uuid FKs, drop orphans), `tripFromSnapshot.js` (rebuild a trip's working columns from
  its frozen LF snapshot — powers **Revert**), `lfEnrichMap.js` (LF customer → `scheduling_people`).
- **Native legs:** `buildNativeLeg.js` (LF-shaped snapshot), `nativeLegStatus.js` (`syncNativeLegStatus`
  propagates trip status into native legs only — never mutates a mirrored leg's snapshot), `canEdit.js`
  (`canEditScheduling(role)`; editor roles: admin/super_admin/primary_admin/owner/dispatcher/scheduler/
  ops_control/sales_admin — everyone else read-only), `workflow.js` (state machine), `numbering.js`/`nextNumber.js`.
- **Reference data** (`scheduling/data/`):
  - **`fleet.js`** — static native fleet map: `N408JS` & `N69FP` → Gulfstream GIV SP, maxPax 15.
    **Extend this as the fleet changes** (native quotes don't call LF for aircraft type). The static
    `fleet.js` is now superseded by the `aircraft` table (migration 022) as the Fleet area's source of
    truth; `fleet.js` remains the fallback for native quote/itinerary/trip-sheet rendering until those
    callers migrate.
  - **`airports.json`** — ~43,390 `ICAO → {lat,lng}` (harvested from LF). This is the **quotable
    universe** — flight time can only be computed for codes present here. `airportNames.json` ~43,389
    `ICAO → {name,city,region}`. `airportSearch.js` ranks From/To suggestions (search universe = the
    coordinate file, so every suggestion is quotable). Unknown airport → **150-min flat fallback** in
    pricing, `null` in `/leg-estimate`.
  - `distance.js` (`greatCircleNm`, haversine), `flightTime.js` (`estimateLegMinutes`; prefers actual
    flown **history** keyed `type|dep|arr`, then route-only, then perf-profile estimate).
  - **Perf profiles:** `perfProfile.js` models per-aircraft-type flight time as a linear fit of
    distance→minutes → `{cruise_kt, buffer_min}` (`DEFAULT_PROFILE = {cruise_kt:452, buffer_min:14}`,
    seeded from 52 GIV-SP legs, R²=0.97). `perfCalibrate.js` refits from `pricing_history` each sync tick
    and upserts `scheduling_perf_profiles`. **Not** a fuel-burn model.
- **People / crew:** `crewAssignment.js` (`buildCrewArrays({pic,sic,fa})` writes seats 2/3/7 into every
  leg snapshot), `peopleName.js` (`identityKey` = name+DOB so same-name people stay distinct),
  `peopleSearch.js` (ranked directory search), `peopleBackfill.js` (one-time dedup), **`docExpiry.js`**
  (`documentAlerts` — passport/visa/green-card: red = expired or expires before the next booked trip;
  amber = within **6 months (IATA rule)** of next departure).
- **Directory sync** (`lfEnrich.js`, runs in the 5-min tick): `importNewPeople()` (hourly-gated insert of
  new LF customers), `enrichPeopleBatch({limit:25})` (bounded detail pull + scan download to the
  `scheduling-docs` bucket, stamps `lf_detail_synced_at`), `linkRecentTripPax()` (LF release pax →
  `scheduling_passengers`). Bulk catch-up is done once via scripts (§22).
- **Storage:** private Supabase bucket **`scheduling-docs`**; signed URLs expire in 3600s.

---

## 7. Quoting, pricing & rate cards

> **There are two parallel "quote" systems — do not conflate them.**
> 1. **OLD email-AI quotes** (`quotes` table, `services/quoteEngine.js`): inbound Gmail → Claude Haiku
>    parses → priced against `rate_cards[0]` → AI-drafted reply. Standalone, legacy. *(The
>    `frontend/src/services/quoteEngine.js` copy is dead.)*
> 2. **NEW native scheduling quotes** (the actively-developed path): a `scheduling_trips` row with
>    `status='quote'`, priced server-side into the `pricing` jsonb column, rendered as branded HTML/PDF,
>    supports a public accept link. **This is the system to extend.**
> Plus **LF read-through** quotes (`/api/quotes/list`, `/quote/:24-hex`): total comes from LF, never
> recomputed.

### The native quote pipeline (source of truth: backend)
1. **Flight time per leg** — `scheduling/priceQuote.js` (`legMinutes`/`priceQuoteLegs`): great-circle nm
   → `flightTimeForLeg` (history override → perf-profile estimate; 150-min fallback for unknown airports).
2. **Rate card selection** — `pickRateCard.selectRateCard(cards, purpose)`: cards are **per-tail +
   purpose** (`owner` vs `charter`), NOT per-route. Match purpose → default (purpose-null) → first.
   No tail → no card → `pricing = {error}` and a blank total.
3. **The math** — `scheduling/pricing.js` `priceTrip({legs, rateCard, nights, faCount, crewCount})`:
   - per leg: `hrs = mins/60`; positioning rate if applicable; `min_hours` floor; short-leg minimum
     (`short_leg_amount`).
   - **Fuel surcharge** = `rawHrs × surcharge_per_hr` (per-flight-hour; migration `011` replaced the old
     `surcharge_pct`). Landing = `legs × landing_fee`. FA/crew/overnight fees from the card
     (`overnight_threshold` default 3 → first 3 nights free).
   - **FET base** = flight + surcharge + landing + FA + crew + overnight. **FET** = `fetBase × fet_rate`
     (charter ~7.5%, owner 0). **Segment fee** = `segment_fee_per_pax × Σpax` sits **OUTSIDE** the FET
     base. **Total** = fetBase + FET + segment fee.
   - Also emits nominal **`costPerHr`** (rate-card `hourly_rate`) and **`posRate`** (`positioning_rate`).
4. **Persist** — `priceAndStore()` writes the itemized breakdown to `scheduling_trips.pricing` + `rate_name`.
   The `pricing` jsonb also stores `costPerHr`, `posRate`, `overrides`, and `effectiveHourly` (additive; no migration).

**Manual per-line re-price** — `recomputeFromInputs(i)` (`PATCH …/price-lines`): recomputes from editable
rate inputs + **ad-hoc fees** (`feeCatalog`: Uber/hotels/catering/de-ice/etc., each `{code, description,
amount, taxable}`). **Taxable** fees join the FET base; **non-taxable** are added after FET.
`fetEnabled=false` → FET 0 (owner). `totalOverride` **wins** over the computed total (sets `manual:true`).
Takes `flightCost` as a precomputed per-trip input (fallback `hourlyRate × hours`) and an **`overrides`
map** that pins specific lines (`flightCost | surcharge | landingCost | overnightCost | faCost |
crewCost | segmentFee`): a pinned line uses the saved dollar amount and is not recomputed. Derives
**`effectiveHourly`** = `flightCost / hours`. When `costPerHr` or `posRate` are edited,
**`computeFlightCost(legs, rateCard, {costPerHr, posRate})`** recomputes the per-leg flight cost
honoring min_hours/short-leg flooring — unless the flight line is pinned. **`POST …/price`
(Recalculate)** = full reset: fresh rate-card price via `priceAndStore`, drops all `overrides`.
`repriceFromBase` (leg/aircraft swap) also preserves the `overrides` map.

> **Pricing is duplicated frontend↔backend, deliberately, for the manual-edit recompute only.**
> `frontend/src/lib/feesMath.js` `recomputeInputs` is a **line-for-line mirror** of backend
> `recomputeFromInputs` (a `feesMath` test asserts `deepEqual`), including the `overrides` map and
> `effectiveHourly` — used to show the live on-screen total while editing. **The backend is the
> source of truth** (the persisted `pricing.total` always comes from a backend recompute). Keep the two
> in lockstep. The frontend does **not** reimplement `priceTrip`.

### Rendering, public quote & accept
- **`quoteHtml.js`** `renderQuoteHtml(vm, {print, web})` — one renderer for both the dashboard iframe and
  the PDF (dark "Midnight" theme). **`quotePdf.js`** = the shared Puppeteer PDF path (see §8). VMs:
  `quoteData.js` (LF), `nativeQuoteData.js` (native). `quoteMap.quoteTotal` ordering is **load-bearing**:
  `total → override → calculatedTotal` LAST (reordering reintroduces the stale-price bug).
- **Public web quote** `routes/publicQuotes.js` (mounted `/quote`, **unauthenticated** — the id is the
  access token): `GET /quote/:id` (uuid→native, 24-hex→LF), `/quote/:id/pdf`, `/quote/:id/accept`.
- **Accept** (migration `019`, native only): `/quote/:id/accept?name=` sets `accepted_at`/`accepted_note`
  and emails `info@flyexjet.vip`. **Accept records a "Request to Book" + notifies ops — it does NOT book
  the trip;** a dispatcher still books it.

### Rate-card data model & endpoints
`rate_cards` base table was created **out-of-band** in Supabase (not in any migration); migrations only
ALTER it: `010` (+`fa_fee`/`crew_fee`/`landing_fee`/deprecated `surcharge_pct`), `011`
(+`surcharge_per_hr`), `018` (+`label`/`purpose`). Endpoints — `routes/rateCards.js` (`/api/rate-cards`):
`GET /`, `POST /`, `PUT /:id`, `DELETE /:id`.

**Native quote endpoints actually live in `routes/scheduling.js`:** `POST /quote-preview` (price without
persisting), `POST /trips` (create + assign quote#), `POST /trips/:id/price`, `PATCH
/trips/:id/price-lines`, `GET /quotes` (list).

> **`routes/pricing.js` is NOT mounted** in `index.js` — dead/unreachable. Its regression engine
> (`pricingModel.js`: `buildRegressionModel`/`estimatePrice` over `pricing_history`) is reachable only via
> scripts/the agent, not HTTP. (`pricing_history` is still read live by `priceQuote`/`perfCalibrate`.)
> The frontend `pages/PricingModel.jsx` that would consume it is **also orphaned** (not routed).

---

## 8. Backend-rendered documents

**Architecture principle (a golden rule):** quote, passenger **itinerary**, and crew **trip sheet** are
**rendered as HTML server-side**, and that *same HTML* is used for **both** the web view and the
Puppeteer **PDF**. **The frontend receives finished HTML/PDF, never raw JSON to render.** Renderers are
pure VM→string functions; only the `build*` data services do I/O.

- **Same VM shape across LF and native** (load-bearing): each doc has an LF-derived builder and a
  **native** builder that re-shapes native rows into the LF shape (`toLfLeg`/`toReleaseLeg`) so one
  renderer covers both. Changing one builder's output keys must be mirrored in the other.
- **Itinerary** (`itineraryData.js` LF / `nativeItineraryData.js` native + `itineraryHtml.js`): dark
  "Midnight" theme; only legs with `pax>0` shown (else all); "PREPARED FOR" = `client.company` (→ name);
  Leaflet route map + per-airport daily weather forecast. Public routes `routes/publicItinerary.js`:
  `GET /itinerary/:id`, `/itinerary/:id/pdf`, and a public `GET /itinerary/email-logo.png` (declared
  before `/:id`). Send via `itineraryEmail.js` (pure builder) + `gmail.js`; scheduling routes:
  `…/itinerary/email-preview` and `POST …/itinerary/send {to,cc,recipientName}` (best-effort PDF attach).
- **Trip sheet (flight release)** (`tripSheet.js` LF / `nativeTripSheetData.js` native + `tripSheetHtml.js`):
  per-leg call sign, **Part 91 vs 135 flight-type chip**, comms/METARs, crew (PIC/SIC/FA + DOB/phone),
  dep/arr FBO, pax manifest (name/weight/DOB/passport, lead highlighted), aircraft status & currency.
  **Auth-guarded** (PII!) — `routes/tripSheet.js`: `GET /api/tripsheet/:id`, `/api/tripsheet/:id/pdf`.
  **Native trip sheets have no maintenance and blank comms/METAR/elevation** (LF-only fields).
- **Shared helpers:** `docTime.js` (`easternTime` America/New_York auto EST/EDT + short tz; `zuluTime`
  UTC `HH:mm Z` — convention: **Eastern primary, Zulu beneath**), `docMap.js` (`mapScript` — inline
  Leaflet route map + animated plane; sets `window.__mapReady` so the PDF waits for tiles; basemap =
  Stadia when `STADIA_API_KEY` set, else keyless CARTO dark), `leadPassenger.js`, `paxCount.js`.
- **PDF specifics** (`quotePdf.js` `renderQuotePdf`, shared by all three docs): `puppeteer-core` +
  `@sparticuz/chromium` (**Linux-only bundled chromium — set `PUPPETEER_EXECUTABLE_PATH` to a local Chrome
  on macOS dev**); Letter, **zero margins** (full-bleed dark), `printBackground`, waits for
  `window.__mapReady` (15s cap), `break-inside:avoid` on sub-blocks. **Output must be `Buffer.from(bytes)`**
  before `res.send` or the PDF corrupts. Doc logos are inlined data-URIs; the email logo must be a hosted
  URL (clients strip data-URI images).

---

## 9. ADS-B tracking & the calendar actual-times overlay

Shows scheduled-vs-actual departure/arrival on the calendar + a live Leaflet fleet map. Backed by
crowd-sourced (or paid) ADS-B. Branch of note: `feat/adsb-live-tracking`. All persistence soft-fails
without Supabase.

- **Providers** (`services/adsb.js`): `getLivePositions()` per fleet tail, 20s cache. `ADSB_PROVIDER`
  default `airplanes_live` (free, no key); `adsbx_rapidapi` / `adsbx_direct` need `ADSB_API_KEY`. Fleet
  tails from `ADSB_FLEET` (default `N69FP,N408JS`).
- **Recorder** (`services/adsbRecorder.js`, `startRecorder`): always-on 20s poller. Writes moved
  positions to the **`adsb_positions` firehose** (14-day retention, pruned hourly). On ground↔air
  transitions records live `actual_dep`/`actual_arr` to `leg_actuals` (matched to the active leg via
  `matchActiveLeg` + `activeLegs.js`), source **`live`**.
  - **Working-tree change (uncommitted):** departure no longer blindly trusts "now". On a newly-airborne
    tick: if a real ground→air was witnessed, `dep=now`; else `recoverDepFromHistory` queries the
    persisted firehose over the leg window (`deriveActualTimes` → exact stored transition, else first
    airborne sample); only falls back to "now" within 2h of schedule, otherwise leaves dep unset
    (**honest over guessing**).
- **Reconciler** (`services/flightTrackReconciler.js`, `startReconciler`): boot backfill + **hourly**.
  Snapshots completed legs to **`flight_tracks`** (permanent, only if `track.length≥2` — never store an
  empty/1-point track, it would lock the leg out of retry). Records actuals as BACKFILL: **`exact`**
  (firehose transition) else **`approx`** (first/last airborne, guarded to ≥50% of scheduled duration);
  plus a crew-block-times pass (source **`crew`**, from LF `block` OOOI).
- **Source priority** (`services/legActualsStore.js`): **`crew` > `live` > `exact` > `approx`**, applied
  **per field**, **never downgraded** (`recordLegActual` upserts on `leg_id`, keeping the higher-priority
  value). `crew` = pilot OOOI = the only true actuals LF exposes.
- **Coherence invariant** (`adsbTrack.coherentArrival`): a leg counts as truly arrived/complete ONLY when it
  has both an actual dep AND an actual arr with **arr > dep**. `recordLegActual` rejects an arr ≤ dep (or an
  arr with no dep); `matchActiveLeg` (earliest not-yet-*coherently*-arrived leg) and the calendar
  (`legStateColor`/actual bar) ignore incoherent actuals — so a corrupt row can't mark a leg "started"/"done"
  or mis-advance to the next leg. `matchActiveLeg` reads each leg's actual dep+arr via `activeLegs` →
  `legActualsStore.getActualsByLeg`. Real corruption self-heals once `crew` block times are logged.
- **Pure helpers** (`services/adsbTrack.js`, unit-tested): `detectTakeoff`, `deriveActualTimes`,
  `approximateActualTimes`, `matchActiveLeg`, `crewActualsFromLeg`, `clipTrackToLeg`, `firstAirborneTime`,
  `normReg` (tail canonicalization — everything `normReg`s tails on both sides before matching).
- **Endpoints** (`routes/adsb.js`, `/api/adsb`, guarded): `GET /positions` (+`airborneSinceMs`),
  `/trail` (persisted firehose, last 12h), `/actuals?from&to` → `{legId:{actualDep,actualArr,depSource,
  arrSource}}` (backs the calendar overlay), `/previous-flights?tail&days`, `/flight-track/:legId`.
- **`weather.js`** (NOT part of ADS-B): Open-Meteo **daily forecast** by lat/lng for the itinerary/trip-sheet
  outlook. **Not** METAR/TAF (the agent's `get_airport_weather` fetches live METAR/TAF from aviationweather.gov).
- **Coverage caveat:** free ADS-B often misses FBO ground coverage and picks planes up mid-climb, so
  precise wheels-up/down is frequently unavailable. The live calendar bar starts at scheduled dep as a
  placeholder. A paid feed (`ADSB_API_KEY`) would improve this — the abstraction already supports it.
- **GOTCHA:** **Never interpolate a fake mid-route position.** With no live fix, a scheduled-active flight
  is parked at its departure airport as **"Awaiting signal"** (this was a real bug). Tracks come only from
  observed firehose points. Two retention tiers: `adsb_positions` = 14-day firehose; `flight_tracks` +
  `leg_actuals` = permanent. `leg_actuals` (017) **supersedes** `flight_tracks.actual_*` (016, dropped).

---

## 10. Fuel-price ingestion

Vendor contract-fuel CSVs emailed weekly to `operations@flyexjet.vip` → scanned from Gmail, parsed,
stored in `fuel_prices`. Code: `backend/src/services/fuel/`; route `routes/fuel.js`; migration `021`.
**Opt-in:** `FUEL_MAIL_SCAN=on` (weekly worker, `startFuelMailWorker`). Feeds a future **"true cost-per-hour"
quoting** project.

- **Pipeline:** `fuelMailWorker` → `fuelMailScan` (Gmail query `from:(fuelmanagement@everest-fuel.com OR
  fosnda@wfscorp.com) has:attachment newer_than:21d`, ≤25 msgs) → `routeVendor` (sender-first detection)
  → `parseWfs`/`parseEverest` (papaparse) → `fuelStore.replaceVendorPrices`. **Dedup is DB-side** per
  Gmail message id (`fuel_price_imports` log); the **mailbox is never mutated** (safe for a shared inbox).
- **Storage semantics:** "replace-per-vendor" — **insert new rows first, then delete the vendor's old
  rows** (a bad file never wipes good data). Rows with blank ICAO or price ≤ 0 are dropped (`csv.num`
  returns null, never 0).
- **Separate Gmail OAuth app** for `operations@` (`GMAIL_OPS_*`, scope `gmail.readonly`), distinct from the
  main sending `GMAIL_*`. One-time token mint via `scripts/fuelGmailAuth.mjs`. `gmailClientFor(config)` in
  `gmail.js` builds the dedicated client.
- **Endpoints** (`/api/fuel`): `POST /scan` (on-demand, role-gated), `GET /prices?icao&vendor`, `GET /imports`.
- **Roadmap:** matching `fbo_name` to the FBO directory (vendor names differ from LF), and price × burn →
  cost/hour, are deferred to the cost project. ForeFlight & LF fuel APIs were rejected as sources (own the data).

---

## 11. Slack per-trip channels

Auto-provisions **two private Slack channels per booked trip** — ops/crew (`trip-<n>`) + accounting
(`trip-<n>-acct`) — pre-populated with crew + fixed groups. Code: `backend/src/slack/` + `services/slack*.js`
+ `tripCrewStore.js`; migration `020`. **PR #8, opt-in, dark until `SLACK_TRIP_CHANNELS=on`** (also needs
`SLACK_BOT_TOKEN`). Awaiting migration 020 + Slack app rollout.

- **Watcher** (`slackWatcher.js`, `startSlackWatcher`, **60s**): defaults the `since` cutoff to **boot time**
  so the first deploy never back-provisions history. **Source = the scheduling mirror, NOT a live LF call**
  (depends on `SCHEDULING_SYNC=on`). Each tick: `provisionNewTrips` then `topUpMembership`.
- **Idempotency is per trip NUMBER** (a number can map to several dispatch oids after delete+recreate).
  Only **booked** trips (with a `trip_number`) get channels.
- **Members:** crew from leg snapshots (seats 2/3/7), matched **by email** (lowercased) via
  `users.lookupByEmail` → `slack_user_overrides` fallback. Email backfilled from the cached LF user
  directory (`lfUserDirectory.js`, oid→email, 30-min TTL). Ops = crew + `SLACK_OPS_MEMBERS`; accounting =
  `SLACK_ACCOUNTING_MEMBERS` + `SLACK_MANAGEMENT_MEMBERS` (no crew, no top-up). **Invite-only, never removes
  anyone; no archiving.** Passengers/clients are never added.
- **Slack client** (`services/slack.js`): minimal Web API client (bot token); `conversations.create`
  (adopts on `name_taken`), `invite`, `lookupByEmail`, `postMessage`; 429 backoff. Required scopes:
  `groups:write`, `channels:manage`, `chat:write`, `users:read.email`.
- The `mcp__claude_ai_Slack__*` MCP tools available in the Claude environment are **unrelated at runtime**
  (used during dev to look up group IDs); the server uses only its own bot token.

---

## 12. Finances / QuickBooks

`services/quickbooks.js` (`intuit-oauth` + raw `fetch` against the QBO REST API). **QuickBooks is kept.**

- **Refresh-token persistence:** access tokens minted on demand; **if QBO rotates the refresh token it is
  persisted to `process.env` AND upserted into the Supabase `app_config` table** (`key='QB_REFRESH_TOKEN'`).
  `index.js` **loads it back from `app_config` on boot** — so the rotated token survives deploys.
  (`app_config` is a small out-of-band `key`/`value` table — no migration — currently used only for this token.)
- **Modeling quirks:** aircraft are QBO **Classes** (`N69FP`, `N408JS`); trips are **sub-customers named
  `Trip XXXXX`** (the formal Projects feature isn't on this plan tier). Class summarization needs the plural
  `'Classes'` enum. `getProjectProfitability` may be rejected by plan tier — callers must `.catch`.
- **Endpoints** (`routes/finances.js`, `/api/finances`): `GET /summary` (the main dashboard batch),
  `/raw-invoices`, `/by-aircraft`, `/by-trips`, `/gl/:aircraft`, `/auth-url`; **`GET /callback` is PUBLIC**
  (OAuth redirect, mounted pre-guard, returns the refresh token + realm to paste into Railway); and
  temporary **`/debug/*`** endpoints that are **exempted from auth** in `index.js` (TODO: remove with the
  debug routes). Env: `QB_CLIENT_ID/SECRET/REDIRECT_URI/REFRESH_TOKEN/REALM_ID`.

---

## 13. ForeFlight briefings

`services/foreflight.js` (`axios`, base `https://dispatch.foreflight.com`, `x-api-key: FOREFLIGHT_API_KEY`,
read-only). Endpoints (`routes/foreflight.js`, `/api/foreflight`, guarded) are thin pass-throughs:
`/aircraft`, `/crew`, `/flights`, `/flights/:id` and per-flight `/briefing`, `/navlog`, `/wb`, `/overflight`,
`/icao`. Used by the dashboard Overview/Aircraft/Crew pages and FlightDetail.

> **Two ForeFlight clients exist.** Production uses `services/foreflight.js`. The AI agent uses
> `agent/providers/foreflight.js` (native `fetch`, env-overridable base, plus it fetches the signed RWA/
> briefing **PDF and extracts text** via lazily-imported `pdf-parse`). Edit the right one.

---

## 14. AI agent ("Operations Copilot") + manuals RAG + NTSB

> **Status: be aware, not the current focus.** Active work is the scheduling rebuild. Two surfaces exist:

- **`/api/assistant` — LEGACY, being deprecated** (`origin/chore/remove-old-assistant-widget`).
  `routes/assistant.js` `POST /chat`: pastes all live ops/finance data into one giant system prompt, calls
  the Anthropic REST API directly (`claude-opus-4-5`, no tools/streaming/persistence). Don't build on it.
- **`/api/agent` — CURRENT agentic loop.** `routes/agent.js` → `agent/agent.js`: a real read-only tool-use
  loop (`@anthropic-ai/sdk`, default `claude-opus-4-7`, `ANTHROPIC_API_KEY`), with RAG, a grounding check,
  structured "Flight Readiness Review" output, **NDJSON streaming**, and Supabase persistence. Build here.
  - **System prompt:** `agent/system_prompt_dispatch_v1.md` — the "Exjet Operations Copilot": **suggests,
    never acts** (final authority is human); **uses tools, never guesses; cites every fact**. Its core
    deliverable is a 6-check readiness review (crew/compliance/weather/airport_runway/performance/
    airport_intelligence). It **must end by calling the terminal `render_review` tool exactly once** (the
    loop captures its input and stops; `render_review` is never executed as a real tool).
  - **Tools** (`agent/tools/`, all read-only): `list_flights`/`get_flight`/`get_performance`/
    `get_runway_analysis`/`get_weather_briefing` (ForeFlight), `get_airport_weather` (live METAR/TAF),
    `list_aircraft`/`get_aircraft`/`get_aircraft_compliance`/`get_crew_availability` (LF — the last computes
    full **duty/rest** analysis vs FAR §135.267 + Exjet thresholds), `get_airport_safety_history` (Exjet SMS
    tickets), `get_ntsb_accident_history`, `search_manuals` (RAG), `render_review`. (There is **no** standalone
    "tickets" tool — `tickets.test.js` guards the SMS-lifecycle helpers in `tools/index.js`.)
  - **RAG** (`grounding.js`/`embeddings.js`, migration `003`): **pgvector + HNSW**, embeddings via **Voyage
    AI `voyage-3` (1024-dim)** (`VOYAGE_API_KEY`). The only corpus is `backend/manuals/GOM.pdf` (General Ops
    Manual), ingested by `scripts/ingest-manuals.js` (idempotent delete-then-insert). The embedding dim is
    hard-coupled to the `vector(1024)` column + the `match_manual_chunks` RPC — changing the model dim breaks
    the schema. `checkGrounding` is a separate anti-hallucination pass (flags tail numbers / ICAOs not present
    in tool output) — **not** a fact checker.
  - **Reviews** (`reviewStore.js`, migrations `001/002/004`): each `runAgent()` saves an `agent_reviews` row.
    `listReviewsByContext` parses the literal kickoff template — **the trailing periods in its `ilike`
    patterns are load-bearing**; changing `buildReviewKickoff` text silently breaks lookup.
  - **NTSB** (migration `005`, `scripts/importNtsb.js` + `ntsbProfile.js`): the agent **only ever reads
    `ntsb_airport_profiles`** (pre-aggregated, never raw `ntsb_raw` — token budget). Import needs `mdbtools`
    + the NTSB `avall.mdb`, refreshed manually ~quarterly.

> **Two Supabase clients with opposite failure modes:** `agent/serviceClient.js` **throws** if unconfigured
> (read tools fail loud); `reviewStore.js` keeps its own client that **returns null** (persistence fails soft).
> Don't cross them. And the agent's `agent/providers/*` are distinct from `services/*` (see §5, §13).

---

## 15. Maintenance

`routes/maintenance.js` (`/api/maintenance`): serves **LF work orders** for both fleet tails (oids
hard-coded here) merged with manually-entered `maintenance_events` rows. Endpoints: `GET /` (merged),
`POST /` (manual event), `DELETE /:id`, `POST /sync-workorders` (upsert open LF work orders), `GET
/workorders`. These appear on the Calendar. Separate from the agent's live `get_aircraft_compliance` tool.

---

## 16. Auth & security model

- **Frontend** (`lib/supabase.js`): Supabase email/password auth (anon key), session in localStorage
  (`sb-exjet-auth`). `components/RequireAuth.jsx` gates all non-login routes. `lib/api.js` `apiFetch`
  attaches `Authorization: Bearer <access_token>` on every call and **on HTTP 401 signs out + hard-redirects
  to `/login`**.
- **Backend** (`middleware/requireAuth.js`): reads the bearer token and **verifies it via
  `supabase.auth.getUser(token)`**. **Supabase access tokens are ES256 (asymmetric) — NEVER `jwt.verify`
  with HS256.** Sets `req.user = {id, email, role}` (`role = user_metadata.app_role || 'crew'`).
- **Mounting** (`index.js`): public (pre-guard) = `/health`, `/api/finances/callback`,
  `/api/quotes/auth-callback`, **`/quote`**, **`/itinerary`**. Everything else under `/api/*` requires
  auth, **except `/api/finances/debug/*`** (temporary exemption). The **public quote/itinerary id is the
  bearer token** — don't move the PII-bearing trip sheet to a public route.
- **Three Supabase clients, different keys/lifecycles:** `services/supabase.js` (service-role, eager),
  `requireAuth.js` (anon key), `agent/serviceClient.js` (service-role, lazy). The service key bypasses RLS.
- **Secrets/PII:** never print `.env` values or real passenger PII (names/DOB/passport) in tool output —
  use counts/structure when probing data.

---

## 17. Background workers (started in `index.js` on `listen`)

| Worker | File | Cadence | Opt-in flag | What it does |
|---|---|---|---|---|
| `startRecorder` | `services/adsbRecorder.js` | 20s poll, prune hourly | always on | ADS-B firehose + live `leg_actuals` |
| `startReconciler` | `services/flightTrackReconciler.js` | boot backfill + hourly | always on | `flight_tracks` snapshots + backfill/crew actuals; also runs a best-effort component-time accrual pass (`accrueAllCompleted` — rolls completed pilot Flight Info into `component_time_entries`; soft-fails if fleet tables are absent) |
| `startSyncWorker` | `scheduling/syncWorker.js` | 5 min | **`SCHEDULING_SYNC=on`** | LF → Supabase mirror + people directory |
| `startFuelMailWorker` | `services/fuel/fuelMailWorker.js` | boot + weekly | **`FUEL_MAIL_SCAN=on`** | scan `operations@` Gmail → `fuel_prices` |
| `startSlackWatcher` | `slack/slackWatcher.js` | 60s | **`SLACK_TRIP_CHANNELS=on`** (+`SLACK_BOT_TOKEN`) | provision per-trip Slack channels |

All workers + their stores **soft-fail** (no Supabase / un-applied migration / disabled flag → they log and
no-op), so local boots and tests never touch LF/Slack/Gmail unless explicitly enabled.

---

## 18. Database schema (Supabase Postgres)

Migrations `001`–`021` in `backend/migrations/`, applied **manually** (§3). Two tables are created
**out-of-band** in Supabase (no migration file): `rate_cards` (only ALTERed by migrations) and
`app_config` (a simple `key`/`value` table, currently holding only `QB_REFRESH_TOKEN` — see §12).
Catalog (table → what a row is → key columns):

**AI / safety**
- `agent_reviews` (001/002/004) — one Operations Copilot run. `id`, `question`, `final_answer`, `tool_calls`,
  `grounding`, `model`, `flight_id`, `review` (jsonb), `conversation` (jsonb).
- `manual_chunks` (003) — one embedded GOM chunk. `manual_name`, `section`, `page_number`, `content`,
  `embedding vector(1024)`. RPC `match_manual_chunks`.
- `ntsb_raw` (005) — one airplane per NTSB event (reference only). `ntsb_number` PK, event/airport/make/
  model/severity/damage/weather/phase/narrative/cause/lat-lon.
- `ntsb_airport_profiles` (005) — pre-aggregated per airport (the only NTSB table queried). `airport_code`
  PK, counts, `top_*` text[], `recent_events` jsonb, `pattern_warnings`.

**ADS-B / tracking**
- `adsb_positions` (006) — firehose fix (~20s, ~14-day window). `registration`, `lat/lon`, `altitude_ft`,
  `on_ground`, `t`.
- `flight_tracks` (007) — permanent per-leg track snapshot. `leg_id` PK (LF leg id), `registration`,
  `from/to_airport`, `dep/arr_time`, `track jsonb`.
- `leg_actuals` (017, supersedes 016) — actual dep/arr per leg. `leg_id` PK, `dep_time` (SCHEDULED, for range
  queries), `actual_dep_time/actual_arr_time`, `dep_source/arr_source` (`crew`/`live`/`exact`/`approx`).

**Scheduling (008 + later)**
- `scheduling_trips` — a trip across its lifecycle. `id` uuid PK, `lf_oid` UNIQUE, `status`, `trip_number`/
  `quote_number`/`purpose`, `*_lf_oid`, `rate_name`, `pricing` jsonb, `origin` (CHECK), `lf_synced_snapshot`,
  `locally_modified`/`upstream_changed`, `company_name`, `contact` jsonb, `checklist` jsonb, `booked_by/at`,
  `accepted_at/note`.
- `scheduling_legs` — a leg. `id` PK, `trip_id` FK→trips CASCADE, `lf_oid` UNIQUE, `seq`, `dep/arr_icao`,
  `dep/arr_time`, `dep/arr_fbo`, + provenance columns.
- `scheduling_crew_assignments` — crew on a leg. `leg_id` FK→legs, `crew_lf_oid`, `seat`, + provenance.
- `scheduling_passengers` — per-trip pax join. `trip_id` FK, `person_id` FK→people (RESTRICT), `seat`,
  `weight_lbs`, `tsa_status`, per-trip overrides.
- `scheduling_people` (014/015) — persistent passenger directory. identity + `passport_*`/`visa_*`/
  `green_card_*`/`known_traveler_number`, `lf_oid`, `lf_detail_synced_at`.
- `scheduling_documents` (012/013/014) — file metadata for the private `scheduling-docs` bucket. `trip_id`
  (nullable)/`passenger_id`/`person_id` (CHECK: trip OR person), `storage_path`, `doc_type`.
- `scheduling_sync_status` — per-entity sync freshness. `entity` PK, `last_success_at`, `status`, `counts`.
- `scheduling_perf_profiles` (009) — calibrated flight-time profile per type. `aircraft_type` PK, `cruise_kt`,
  `buffer_min`, `n_legs`, `r2`.

**Quoting / pricing**
- `rate_cards` (out-of-band + 010/011/018) — pricing card per tail+purpose. `aircraft_tail`, `purpose`,
  `label`, `surcharge_per_hr`, `fa_fee`/`crew_fee`/`landing_fee`, plus base rate fields.
- `airport_fbos` (018) — one FBO at an airport (bulk-imported from LF). `fbo_id` PK, `icao`, `name`,
  `address`/`phones`/`comms` jsonb, `lat/lng`.
- `pricing_history` (out-of-band) — historical actual flight minutes per `type|dep|arr`; read by
  `priceQuote`/`perfCalibrate`/`pricingModel`.

**Slack / fuel**
- `trip_slack_channels` (020) — `lf_dispatch_oid` PK, `trip_id`, `ops/acct_channel_id`, `invited_slack_ids`,
  `first_dep_at`, `status`.
- `slack_user_overrides` (020) — `lf_email` PK (lowercased) → `slack_user_id`.
- `fuel_prices` (021) — a vendor fuel-price tier row. `vendor` (`wfs`/`everest`), `icao`, `fbo_name`,
  `fuel_type`, `tier_from/to_gal`, `price`/`taxes`/`total_price`, `effective_date`, `import_id`.
- `fuel_price_imports` (021) — per-Gmail-message ingest log. `gmail_message_id` PK, `vendor`,
  `rows_imported`, `status`.

**Fleet (022)**
- `aircraft` (022) — one plane; `id` uuid PK, `tail` UNIQUE, `lf_aircraft_oid`, `origin`, basic-info + performance columns, `lf_synced_snapshot`/`locally_modified`. Replaces static `fleet.js` as the Fleet area's source of truth.
- `aircraft_components` (022) — engine/apu/airframe per aircraft; identity (`serial`/`model`/`manufacturer`), `baseline_hours/cycles` + `total_hours/cycles`, `apu_last_reading`, `accrues_flight_time`/`tracks_cycles`.
- `component_time_entries` (022) — append-only time ledger; `component_id`, `leg_id` (UNIQUE per component+leg = idempotency), `hours_delta`/`cycles_delta`, `source`, `time_source`.
- `flight_info` (022) — one pilot post-flight log per leg; `scheduling_leg_id` UNIQUE, OOOI (`out/off/on/in_at`), fuel/APU/oil, `approach_type`, `debrief`, `status`.
- `flight_info_crew` (022) — PIC/SIC per-pilot rows; `performed_takeoff/landing`, `imc_hours`, `night_hours`.

---

## 19. HTTP API surface (route catalog)

Mounted in `index.js`. **Public** (no auth): `/health`, `/quote/*` (`publicQuotes.js`), `/itinerary/*`
(`publicItinerary.js`), `/api/finances/callback`, `/api/quotes/auth-callback`. **Auth-guarded `/api/*`**
(exempt: `/api/finances/debug/*`):

| Router | Mount | Highlights |
|---|---|---|
| `scheduling.js` | `/api/scheduling` | the native scheduling/quoting API — trips CRUD, legs, `/quote-preview`, `/price`, `/price-lines`, `/people`, `/passengers`, `/documents`, `/crew-roster`, `/airport-search`, `/airport/:icao/fbos`, `/leg-estimate`, `/revert`, itinerary send. `GET /quotes` list includes `quote_number`. `GET /quotes/:quoteNumber` resolves a quote by Quote # → `{ trip, legs }`. `GET /trips/:id` now also accepts a `trip_number` (read-only; mutations still require uuid/lf_oid via `tripColumn`). `PATCH /trips/:id/details` also persists `purpose`/`company_name`/`contact` and returns `{ ok, pricing }`. Reprice (`priceAndStore`/`repriceFromBase`) preserves manual ad-hoc fees, FET-off, total override, and `overrides` map. `PATCH /price-lines` persists `costPerHr`/`posRate`/`overrides` and recomputes per-leg flight cost when those rates change (skipped if flight line is pinned); `POST /price` = Recalculate: fresh rate-card price, drops all `overrides`. Mutations gated by `requireSchedulingEditor`. |
| `levelflight.js` | `/api/levelflight` | live LF read-through: `/legs` (2mo back/3mo fwd, pax-count corrected), `/duty`, `/aircraft`, `/pilots`, `/trip/:oid`, `/pilot-calendar`, `/aircraft-status/:oid`. |
| `adsb.js` | `/api/adsb` | `/positions`, `/trail`, `/actuals`, `/previous-flights`, `/flight-track/:legId`. |
| `quotes.js` | `/api/quotes` | OLD email-AI quotes (`/scan`, CRUD, `/:id/send`) + LF quote read-through (`/list`, `/dispatch/:id/preview\|pdf\|send-link`). |
| `rateCards.js` | `/api/rate-cards` | rate-card CRUD. |
| `tripSheet.js` | `/api/tripsheet` | `/:id`, `/:id/pdf` (auth — PII). |
| `finances.js` | `/api/finances` | QuickBooks dashboard (`/summary`, `/by-aircraft`, `/by-trips`, `/gl/:aircraft`); public `/callback`; exempt `/debug/*`. |
| `maintenance.js` | `/api/maintenance` | work orders + manual events. |
| `foreflight.js` | `/api/foreflight` | briefing pass-throughs. |
| `agent.js` | `/api/agent` | readiness review + chat (NDJSON streaming). |
| `assistant.js` | `/api/assistant` | **legacy** one-shot chat. |
| `fuel.js` | `/api/fuel` | `/scan`, `/prices`, `/imports`. |
| `fleet.js` | `/api/fleet` | aircraft profiles CRUD + `POST /aircraft/import` (import from LevelFlight via `getAircraftList`/`getAircraftDetail`), components + `components/:id/ledger` + `components/:id/entries` (manual time/adjustment). |
| `pricing.js` | — | **NOT mounted (dead).** |

> **Flight Info routes on `scheduling.js`:** `GET/PUT /api/scheduling/legs/:legId/flight-info` + `POST .../complete` (pilot post-flight log; legId resolves lf_oid (24-hex) or uuid id; access guard `requireFlightInfoAccess` = editors or assigned crew).

---

## 20. Frontend (React + Vite)

`frontend/` — React 19 + Vite 8, React Router 7, no TypeScript. Styling is mostly **inline `style={{}}`
objects using CSS variables** (Tailwind is installed but barely used). **Force-dark theme app-wide**
(`index.css` paints html+body dark; CSS vars `--bg-primary #0a0a0f`, `--accent #4f8ef7`, etc.).

- **Two shells** (`App.jsx`), both behind `RequireAuth`; `/login` public:
  - **`Dashboard`** at `/*` — left `Sidebar` + `TopNav` + pages.
  - **`SchedulingApp`** at `/scheduling/*` — full-width (no sidebar) + `TopNav`.
  - `TopNav` switches between the two shells + Sign out.
- **Dashboard routes:** `/` Overview, `/map` Map (Leaflet fleet), `/calendar` Calendar (the Gantt),
  `/flights` + `/flights/:id`, `/trips/:id`, `/crew` + `/crew/:id`, `/aircraft` + `/aircraft/:tail`,
  `/clients` + `/clients/:id`, `/rate-cards`, `/finances`, `/maintenance`, `/assistant`, `/crew-calendar`,
  `/quotes`. (`RateCards` & `Maintenance` are hidden from the sidebar; routes still exist.)
- **Scheduling routes:** `/scheduling` (tabbed hub `Scheduling.jsx`), `/scheduling/new` (creates a draft quote then redirects into the editor via `NewQuoteRedirect.jsx`), `/scheduling/quotes/:quoteNo` (`QuoteEditor.jsx` — the streamlined quote editor keyed by Quote #), `/scheduling/trips/:id` (tabbed editor `SchedulingTripDetail.jsx` — `:id` accepts a uuid, 24-hex lf_oid, or trip_number; redirects quote-status rows to `/quotes/:quoteNo` and shows a "View quote ↗" cross-link), `/scheduling/trips/:id/sheet`, `/scheduling/people/:id`. `SchedulingNewTrip.jsx` was replaced by `QuoteEditor.jsx` + `NewQuoteRedirect.jsx`. The `pages/scheduling/*` sub-pages (Overview/Aircraft/Clients/Crew/People/Requests) are **tabs inside `Scheduling.jsx`** (active tab in `?section=`), not top-level routes. The "Schedule" tab reuses `Calendar` with `legsEndpoint="/api/scheduling/legs"`.

> **Quote/Trip addressing:** a single `scheduling_trips` row is the quote while in Quote # space (`/quotes/:quoteNo`) and the booked trip once in Trip # space (`/trips/:tripNo`). No migration — the split is purely a routing/UI convention.

> **Scheduling section ≠ live Flights.** `/scheduling` reads the **Supabase mirror** (`/api/scheduling/*`);
> the dashboard Flights/Calendar default to **live LevelFlight** (`/api/levelflight/*`). The same
> `Calendar`/`FlightsList`/`TripsList` components are reused with different `legsEndpoint`/`tripBasePath`.

- **API client:** `lib/api.js` `apiFetch` (base `VITE_API_URL`||`localhost:3001`, attaches the Supabase
  bearer, 401→login). Hooks: `useApi` (5-min poll), `useAdsb(20000)` (positions/trail, re-ticks on tab
  focus), `useLegActuals(…,60000)` (the settled delay overlay).
- **Notable pages:** `Calendar.jsx` (the scheduling Gantt — views 12h/day/week/month/year; each leg =
  translucent **scheduled** block + solid **actual** bar that grows live; **blue=completed, green=in-flight,
  grey=future** via `legStateColor`; delay math `lib/delaySegments.js`; crew **duty brackets** group flight
  duties within 15 min (`lib/dutyGroups.js`) and mark them **top bar = PIC, bottom bar = SIC** (both when
  grouped) — hover lists each crew member's exact time. **Day/12h are CONTINUOUS:** the timeline spans
  **all flights** (earliest leg → latest leg, always incl. today) and scrolls straight through — no
  per-day paging; offset is ignored, Prev/Next smooth-scroll a day, drill-down focuses the clicked day
  (`dayFocusRef`). Gridlines are a CSS gradient (header+body share it so lines align); the day **date**
  sits in a scroll-synced strip **above** the grid; 24-hour hour axis drops `:00` when columns get
  narrow. `cols` is memoized so the 60s tick doesn't rebuild the (wide) column set. **On-ground**
  blocks are drawn between legs AND a trailing "parked" block after the last leg (so the plane's
  current airport always shows); airport labels are **sticky** (stay visible across a wide block);
  the display helper `arrShown(dep,arr)` trusts an arrival unless it's before a known departure
  (arr-without-dep still renders). A **departed-but-not-confirmed-landed** leg shows a **dashed/amber
  "unconfirmed"** bar (estimate to scheduled arrival) — covers ADS-B coverage gaps AND diversions;
  confirming the actual landing / a future "Divert" mark replaces it). `Map.jsx` (FleetMap — live ADS-B,
  **"Awaiting signal"** when no fix, persisted trail toggle, history replay). `Quotes.jsx`, `Finances.jsx`
  (QB, 6 tabs), `FuelPrices.jsx`, `SchedulingTripDetail.jsx` (tabbed native editor — **Fees tab renamed
  "Pricing"**, tab `id` still `fees`), `QuoteEditor.jsx` (streamlined quote page: inline legs + live
  flight time, per-leg pax, editable client info, compact auto-priced panel with ad-hoc fees + total
  override, debounced autosave, View Quote/PDF/Copy-link + Book + Discard; booked trips use
  `SchedulingTripDetail`). `AgentReviewPanel.jsx` streams the readiness review.
- **Shared pricing components** (`components/pricing/`): `PricingSummary.jsx` (collapsible summary bar
  used in both `QuoteEditor` and `SchedulingTripDetail`), `PricingSlideOut.jsx` (right-side drawer
  editor — edit dollar amounts → per-line pins, ▲▼ steppers, Recalculate, ad-hoc fees, FET toggle,
  Total override; autosaves via `/price-lines`), `pricingRows.js` (`fmtHrs`/`usd`/`pinPatch`/
  `unpinPatch`/`normalizePricing` helpers).
- **lib utils** (7 have `node:test`): `feesMath` (mirror of backend pricing, including per-line `overrides`
  map and `effectiveHourly`), `trips`, `easternTime` (+ `easternInputParts` added for QuoteEditor date/time inputs),
  `calendarRange`, `delaySegments`, `schedulingAggregate`, `formatElapsed`, `feeCatalog`, `basemap`.
- **Fleet pages** (`/fleet/*`): `FleetAircraftList` (aircraft index), `FleetAircraftDetail` (per-tail
  with Basic Info · Performance · Components sub-nav), `FleetComponents` (cross-aircraft component list).
  **Flight Info tab** in `SchedulingTripDetail.jsx` — per-leg pilot post-flight entry form (OOOI, fuel, APU,
  approaches, debrief, Mark Complete); `lib/flightTime.js` provides HH:MM ↔ decimal conversion helpers.
- **Dead/orphan files:** `pages/PricingModel.jsx` (not routed), `routes/quotes.js` + `services/gmail.js`
  (empty stubs), `App.css` (unused Vite boilerplate), `services/quoteEngine.js` (legacy copy).
- **Build/deploy:** `npm run build` (Vite → `dist/`); Vercel SPA rewrite (`vercel.json`); env `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`, `VITE_STADIA_API_KEY`.

---

## 21. Environment variables (names only — never print values)

**Backend** (`backend/.env`):
- **LevelFlight:** `LEVELFLIGHT_BASE_URL`, `LEVELFLIGHT_CLIENT_ID`, `LEVELFLIGHT_TOKEN_URL`,
  `LEVELFLIGHT_AUTH_URL`, `LEVELFLIGHT_REFRESH_TOKEN`, `LEVELFLIGHT_SANDBOX_URL`, (`LEVELFLIGHT_TIMEOUT_MS`).
- **Supabase:** `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`.
- **Anthropic / embeddings:** `ANTHROPIC_API_KEY`, (`ANTHROPIC_MODEL`), `VOYAGE_API_KEY`, (`VOYAGE_MODEL`).
- **ForeFlight:** `FOREFLIGHT_API_KEY`, (`FOREFLIGHT_BASE_URL`, `FOREFLIGHT_TIMEOUT_MS`, `FOREFLIGHT_PDF_TIMEOUT_MS`).
- **Gmail (main, sends quotes/itineraries):** `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`, `GMAIL_REFRESH_TOKEN`.
- **Gmail (ops/fuel, isolated):** `GMAIL_OPS_CLIENT_ID`, `GMAIL_OPS_CLIENT_SECRET`, `GMAIL_OPS_REDIRECT_URI`, `GMAIL_OPS_REFRESH_TOKEN`.
- **QuickBooks:** `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_REDIRECT_URI`, `QB_REFRESH_TOKEN`, `QB_REALM_ID`.
- **ADS-B:** `ADSB_PROVIDER`, `ADSB_FLEET`, (`ADSB_API_KEY`), `ADSB_CACHE_TTL_MS`, `ADSB_TRAIL_MAX_POINTS`, `ADSB_TRAIL_MAX_AGE_MS`.
- **Slack:** `SLACK_BOT_TOKEN`, `SLACK_OPS_MEMBERS`, `SLACK_ACCOUNTING_MEMBERS`, `SLACK_MANAGEMENT_MEMBERS`, `SLACK_CHANNELS_SINCE`.
- **Opt-in flags:** `SCHEDULING_SYNC`, `SLACK_TRIP_CHANNELS`, `FUEL_MAIL_SCAN` (each `=on`).
- **Misc:** `PUPPETEER_EXECUTABLE_PATH` (local Chrome for PDF), `STADIA_API_KEY` (basemap), `PORT`,
  `JWT_SECRET` (legacy — auth uses Supabase ES256, not this).

**Frontend:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`, `VITE_STADIA_API_KEY`
(set in `.env*` locally, as Vercel project env in prod).

---

## 22. Operational scripts (`backend/scripts/`, run from `backend/`, auto-load `.env`)

- **Data import/backfill (mostly one-time, `--dry-run` supported):** `importLfPeople.mjs`,
  `backfillPeople.mjs`, `enrichLfPeople.mjs`, `scansLfPeople.mjs`, `linkLfTrips.mjs`,
  `backfillTripHistory.mjs`, `rehomePassengerDocs.mjs`, `importFbos.mjs` (FBO directory bulk import,
  resumable via a gitignored checkpoint), `importNtsb.js` (needs `mdbtools`), `ingest-manuals.js` (GOM RAG).
- **Reference-data generation:** `genAirports.mjs` / `harvestAirports.mjs` / `harvestAirportNames.mjs`
  (regenerate `scheduling/data/airports.json` + `airportNames.json`).
- **Auth helper:** `fuelGmailAuth.mjs` (mint `GMAIL_OPS_REFRESH_TOKEN`).
- **Probes / smoke tests:** `exjet-api-probe.js`, `test-tools.js`, `test-manuals.js`,
  `test-crew-duty-rest.js`, `ask.js` (agent CLI/REPL), `ntsbProfile.js` (pure, unit-tested).

---

## 23. Testing

Native **`node:test`** throughout (no framework). Tests live **next to source** as `*.test.js`.
- **Backend:** `node --test backend/src/scheduling/*.test.js backend/src/services/*.test.js backend/src/services/fuel/*.test.js`
  (also `slack/*.test.js`, `agent/*.test.js`, `agent/tools/*.test.js`, `scripts/ntsbProfile.test.js`).
- **Frontend lib:** `node --test frontend/src/lib/*.test.js`. **Build check:** `cd frontend && npm run build`.
- Counts: scheduling ~32, services ~17, fuel 3, slack 5, frontend lib 7.

---

## 24. Conventions & gotchas — the golden rules

**Workflow**
- **Review diffs before push:** show the diff + a one-line diagnosis, **wait for an explicit "push"**, then
  push. Never push unprompted. If on `main`, branch first. Commits are co-authored.
- **Never print secrets** (`.env` values) or **real passenger PII** (names/DOB/passport) — use counts/structure.
- **Migrations are manual** — after writing one, ask the user to run it in the Supabase SQL editor. No runner,
  no psql/DDL from Claude. Write stores to soft-fail on a missing table/column.
- Feature specs/plans live in `docs/superpowers/{specs,plans}/` — read the matching design doc before a big change.
- **Keep this file (`CLAUDE.md`) current:** when your change alters anything this guide describes (routes, schema,
  env vars, workers, conventions, in-flight work), update the relevant section **in the same change**. See the
  ⚠️ callout at the top. A stale guide misleads every future agent.

**Domain invariants (silently wrong if violated)**
- **Pax count = `leg.passengers.length`** (`assignedPaxCount`), NOT `passengerCount`.
- **Lead passenger = the passenger with the unique lowest seat** (null on tie). Crew seats: 2=PIC, 3=SIC, 7=FA.
- **Native vs mirror is `origin`-gated everywhere** — only `native` trips edit-details/delete; never mutate a
  mirrored leg's `lf_synced_snapshot` (it's the revert source).
- **Sync is one-way LF→mirror**, opt-in (`SCHEDULING_SYNC=on`). **Never bulk-upsert a heterogeneous batch**
  (insert new, per-row update existing) or you NULL-clobber `locally_modified` working columns.
- **Trip addressing is dual:** hex `lf_oid` vs uuid `id`; documents fork on id shape (uuid→native, 24-hex→LF).
- **Backend renders all documents** — quote/itinerary/trip-sheet data + rendering stay server-side; the
  frontend gets finished HTML/PDF, never raw JSON.
- **ADS-B: never interpolate a fake mid-route position** ("Awaiting signal" instead). Actuals source priority
  `crew > live > exact > approx`, never downgraded. A leg is "arrived" only on a **coherent** actual
  (dep present AND arr > dep) — corrupt actuals are ignored, never mark a leg started/complete (`coherentArrival`).
- **Supabase JWT is ES256** — verify via `supabase.auth.getUser`, never HS256 `jwt.verify`.
- **Pricing source of truth is the backend**; keep `feesMath.recomputeInputs` (frontend) in lockstep with
  `pricing.recomputeFromInputs` (backend), including the per-line `overrides` map and `effectiveHourly`.
  Segment fee sits OUTSIDE the FET base in the NEW model.
- **PDFs locally need `PUPPETEER_EXECUTABLE_PATH`** (bundled chromium is Linux-only); wrap output in `Buffer.from`.
- **Component totals = `baseline + Σ ledger`**; accrual is **idempotent per (component, leg)** (UNIQUE index).
  Engines + airframe accrue **Off→On** flight time + 1 cycle; APU accrues `apu_stop − apu_start` hours +
  running-total cycle delta.
- The **pilot Flight Info "Mark Complete"** is the authoritative accrual trigger; ADS-B `leg_actuals`/LF
  `block` only pre-fill the form.
- **Flight-info routes resolve a leg by lf_oid (24-hex) or uuid id**; the dashboard's mirror-leg objects
  carry `_id.$oid` (= `scheduling_legs.lf_oid`), not the uuid.

**Footguns**
- **Two LF clients & two ForeFlight clients** (production `services/*` vs agent `agent/providers/*`) — edit the
  right one. **Two `quoteEngine.js`** (backend real, frontend dead). **`routes/pricing.js` & `pages/PricingModel.jsx`
  are unmounted/orphaned.**
- **Numbering is TEXT** — compute max in JS, not SQL `ORDER BY`. **`quoteTotal` ordering is load-bearing.**
  **Agent review lookup depends on literal kickoff-template text** (trailing periods matter).

---

## 25. Repository map

```
exjet-dashboard/
├── backend/                      # Node + Express, ESM, deploy → Railway
│   ├── src/
│   │   ├── index.js              # entry: mounts routes, starts the 5 workers
│   │   ├── middleware/requireAuth.js   # Supabase ES256 verify
│   │   ├── routes/               # HTTP routers (§19)
│   │   ├── scheduling/           # the native scheduling rebuild + sync (§5,§6,§7) — 32 tests
│   │   │   └── data/             # airports.json (~43k), airportNames.json
│   │   ├── services/             # integrations + docs + ADS-B + quoting (§5,§8,§9,§12,§13)
│   │   │   └── fuel/             # fuel-price ingestion (§10)
│   │   ├── slack/                # per-trip Slack channels (§11)
│   │   ├── agent/                # AI Operations Copilot (§14) + providers/, tools/
│   │   └── assets/quote/         # logos + N69FP photos for documents
│   ├── migrations/               # 001–021, applied MANUALLY in Supabase
│   ├── scripts/                  # operational scripts (§22)
│   ├── manuals/GOM.pdf           # RAG corpus (gitignored)
│   └── railway.toml
├── frontend/                     # React + Vite, deploy → Vercel (§20)
│   └── src/{pages,components,hooks,lib,services}/
├── docs/superpowers/{specs,plans}/   # design docs per feature (dated)
└── CLAUDE.md                     # this file
```

**Remote/active branches** (see §2): `feat/adsb-live-tracking`, `feat/force-dark-theme`,
`feat/slack-trip-channels`, `feat/calendar-airborne-border`, `feat/map-fullscreen`, `fix/dark-map-background`,
`fix/calendar-airborne-late-leg`, `chore/remove-old-assistant-widget`.
