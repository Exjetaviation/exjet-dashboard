# Exjet Dashboard — Project Guide for Claude Code

> Read this first. It explains the **scheduling software** that is the main focus of work in
> this repo, plus the conventions to follow. Deep details live in the files referenced below.

## What this is
`exjet-dashboard` is Exjet Aviation's internal ops dashboard. The headline initiative is
**rebuilding LevelFlight's scheduling module as Exjet's own software inside this repo.**
- **LevelFlight (LF)** stays the upstream source of truth for flights/dispatches/legs/
  customers — we pull it via the LF API. The goal is to own the scheduling UX + logic, not the data entry.
- **QuickBooks is explicitly KEPT** (finances are not being replaced).
- The repo also has other subsystems (be aware, not the focus): an AI assistant/agent
  (`/api/assistant`, `/api/agent`, NTSB accident data, RAG chunks), maintenance, finances/
  QuickBooks, rate cards / quoting, ForeFlight briefings.

## Stack & deployment
- **Backend**: Node + Express, `backend/` (entry `backend/src/index.js`). Data in **Supabase**
  (Postgres). Deployed on **Railway** (auto-deploys on push to `main`).
- **Frontend**: React + Vite, `frontend/` (pages in `frontend/src/pages`). Deployed on
  **Vercel** (auto-deploys on push to `main`).
- **Tests**: `node:test`. Backend: `node --test backend/src/scheduling/*.test.js backend/src/services/*.test.js`.
  Frontend lib tests are also `node:test`: `node --test frontend/src/lib/*.test.js`. Frontend
  build check: `cd frontend && npm run build`.
- **Migrations**: numbered SQL in `backend/migrations/` (latest `017_leg_actuals.sql`). They are
  **applied MANUALLY in the Supabase SQL editor** — there is no migration runner, and Claude has
  no psql/DDL access (only the Supabase PostgREST client via the service key). After writing a
  migration, ask the user to run it. Stores are written to **soft-fail** if a table/column is
  absent, so deploys don't break before a migration is applied.

## Data sources
- **LevelFlight API** — `backend/src/services/levelflight.js`. Auth: refresh_token → id_token
  (`LEVELFLIGHT_*` env). Key calls: `getScheduledLegs(monthAnchorMs)` (legs by month),
  `getTripLog(dispatchOid)` = `/api/dispatch/{id}/flightLog`, `getDispatchRelease(oid)` =
  `/release`, `getCustomer`, `getDispatchList`. Note the raw `/api/dispatch/{id}` 404s — only
  `/flightLog` and `/release` work.
- **Supabase** — mirror + app tables (see Schema). `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`.
- **ADS-B** — live positions + tracks. Provider via `ADSB_PROVIDER` (default `airplanes_live`,
  free; `adsbx_rapidapi`/`adsbx_direct` need `ADSB_API_KEY`). Fleet tails in `ADSB_FLEET`
  (e.g. `N69FP,N408JS`).
- **Gmail** (OAuth, `GMAIL_*`) — sends quotes/itineraries (`services/gmail.js` `sendEmail({to,cc,subject,html,attachments})`).
- **QuickBooks** (`QB_*`) — finances, kept. **ForeFlight** (`FOREFLIGHT_*`) — briefings.

## The leg shape (LevelFlight) — most scheduling work centers on a "leg"
- `_id.$oid` — **leg id, the canonical key** across the app (calendar/actuals/tracks key off it).
- `departure` / `arrival` = `{ airport (ICAO), time (SCHEDULED epoch ms), fbo {...} }`.
- `dispatch` = `{ _id.$oid, tripId (human trip #), aircraft.tailNumber, aircraft.type.name,
  client {company, customer} }`.
- `pilots: [{user, seat}]` (seat 2 = PIC, 3 = SIC), `attendants: [{user, seat}]`.
- `passengers: [{user, seat}]` = the ASSIGNED pax. **Pax count = `passengers.length`**, NOT the
  separate `passengerCount` field (`services/paxCount.js` → `assignedPaxCount`).
- `status` — 0 Scheduled / 1 Active / 2 Booked / 3 Completed.
- `_calc` — computed: `distance{value}`, `minutes`, `time` (eft), `from`/`to`
  `{ name, location{lat,lng}, timezone, comms, runways, elevation }`.
- `block = {out, off, on, in}` — **CREW-ENTERED OOOI times** (epoch ms), present once pilots log
  post-flight (LF "postFlight" module). out=block-out, off=wheels-up, on=wheels-down, in=block-in.
  **This is the authoritative actual departure/arrival** (out→dep, in→arr). There is no other
  actual-times field in the LF API. Rides along in `getScheduledLegs`.

### Lead passenger
LF's "lead passenger" toggle is NOT an explicit field — it manifests as the SEAT: the lead gets a
unique forward (lowest, distinct) seat; others share a default. `services/leadPassenger.js`
→ `leadUserId(passengers)` = the single passenger with the unique min seat (null if tie/none).
The itinerary + trip sheet show the lead first / highlighted.

## Schema (Supabase — see `backend/migrations/`)
- `scheduling_trips`, `scheduling_legs`, `scheduling_crew_assignments` — local mirror of LF
  dispatches/legs/crew (008), kept fresh by the 5-min sync; rows flagged `locally_modified` are
  never overwritten.
- `scheduling_people` — persistent passenger directory (014), imported/enriched from LF (incl.
  documents/scans). `scheduling_documents` (012), `passenger_documents` (013).
- `perf_profiles` (009), `rate_card_lineitems` (010), surcharge (011).
- `adsb_positions` (006) — 14-day ADS-B firehose (lat/lon/t/on_ground per tail). Trail + actuals
  derive from here.
- `flight_tracks` (007) — permanent per-completed-leg track snapshots (`leg_id`, `track`, scheduled times).
- `leg_actuals` (017) — actual dep/arr per leg for the calendar delay overlay (supersedes 016's
  flight_tracks columns).

## 5-minute sync
`backend/src/scheduling/syncWorker.js` (`startSyncWorker`, opt-in via `SCHEDULING_SYNC=on`) →
`runScheduledLegsSync.js`: fetches LF scheduledLegs (~2mo back / 3mo forward), maps to trips/legs/
crew, writes to `scheduling_*`, auto-closes completed trips, syncs the LF customer directory.

## Backend-rendered documents (single source of truth)
Quote, passenger itinerary, and crew trip sheet are **rendered as HTML server-side** and used for
BOTH the web view and the Puppeteer PDF. **The frontend receives finished HTML/PDF, never raw JSON
to render.** Times shown Eastern (auto EST/EDT) with Zulu beneath (`services/docTime.js`
`easternTime`/`zuluTime`).
- **Itinerary**: `services/itineraryData.js` (VM from getTripLog) + `itineraryHtml.js` (dark
  "Midnight" theme) + `itineraryEmail.js` (send email). Public: `/itinerary/:id` and
  `/itinerary/:id/pdf` (`routes/publicItinerary.js`). "PREPARED FOR" shows `client.company`
  (falls back to name). Email signature logo served at `/itinerary/email-logo.png`.
- **Quote**: `services/quoteHtml.js` + `quotePdf.js` (Puppeteer via `@sparticuz/chromium`; set
  `PUPPETEER_EXECUTABLE_PATH` to a local Chrome for local PDF rendering — the bundled chromium is
  Linux-only). Public `/quote/:id`.
- **Trip sheet (flight release)**: `services/tripSheet.js` + `tripSheetHtml.js`.
- PDFs render with **zero margins** (full-bleed dark); page-break CSS uses `break-inside:avoid` on
  sub-blocks (itinerary legs flow to fill the page).

## ADS-B actuals & the calendar delay overlay (major feature)
Show scheduled-vs-actual departure/arrival on the calendar + a live fleet map.
- **Live positions**: `services/adsb.js` `getLivePositions()` (per-tail provider fetch, 20s cache)
  → `/api/adsb/positions` (+ `airborneSinceMs`). `useAdsb` polls it.
- **Recorder**: `services/adsbRecorder.js` — always-on 20s poller. Saves moved positions to the
  firehose; on ground→air / air→ground transitions records live `actual_dep`/`actual_arr` to
  `leg_actuals` (matched to the active leg via `matchActiveLeg` + `services/activeLegs.js`).
- **Reconciler**: `services/flightTrackReconciler.js` (hourly + boot) — snapshots completed legs to
  `flight_tracks`; records actuals as a BACKFILL: `exact` (firehose transition) else `approx`
  (first/last airborne, guarded to ≥50% of scheduled duration); plus a crew-block-times pass.
- **Source priority** (`services/legActualsStore.js`): **`crew` > `live` > `exact` > `approx`**
  (never downgraded). `crew` = pilot OOOI block times (most authoritative).
- **Endpoint**: `GET /api/adsb/actuals?from&to` → `{ legId: { actualDep, actualArr, depSource, arrSource } }`.
- **Pure helpers** (`services/adsbTrack.js`, unit-tested): `detectTakeoff`, `deriveActualTimes`,
  `approximateActualTimes`, `matchActiveLeg`, `crewActualsFromLeg`, `clipTrackToLeg`.
- **Coverage caveat**: free ADS-B (airplanes.live) often misses FBO ground coverage and picks
  planes up mid-climb, so precise wheels-up/down is frequently unavailable. The system falls back
  (live bar starts at scheduled dep as a placeholder; approx post-flight). A paid feed
  (ADSBExchange) would improve this — code already supports it.

## Frontend — key pages
- **`pages/Calendar.jsx`** — the scheduling Gantt. Views 12h / day / week / month / year (`VIEWS`).
  The 12h view = a 24h range centered on now, viewport shows 12h, scrolls ±12h. Block colour by
  STATE: **blue=completed, green=in-flight, grey=future** (`legStateColor`, uses actuals + live
  airborne). Each leg = a **translucent SCHEDULED block + a solid ACTUAL bar (60% height, centered)
  nested inside**; the actual bar grows live with the now-bar, with a green plane icon at its
  leading edge (right of the now-bar); route label centered. Hovering the scheduled vs actual block
  shows the respective times (`hoverMode`). Actuals via `useLegActuals` (/api/adsb/actuals) + live
  ADS-B; delay math in `lib/delaySegments.js`.
- **`pages/Map.jsx` (FleetMap)** — Leaflet fleet map. Real ADS-B fix wins; with no live fix a
  scheduled-active flight is parked at its departure airport as **"Awaiting signal"** (do NOT
  interpolate a fake mid-route position — that was a bug). "Active flights" sidebar. Flight trail
  from the **persisted firehose** (`/api/adsb/trail`, survives restarts; toggle persisted in
  localStorage). History list + replay of past tracks.
- Trip pages: `Flights.jsx`, `FlightDetail.jsx` (`/flights/:id`), `TripDetail.jsx`,
  `SchedulingTripDetail.jsx` — all have a Send-Itinerary button.
- `pages/Quotes.jsx` — quotes + "Email link" (with Cc). `components/ItinerarySendModal.jsx` —
  preview-then-send itinerary email (recipient, Cc, greeting; attaches the PDF).
- Hooks: `useAdsb.js`, `useLegActuals.js`, `useApi.js`. Lib: `delaySegments.js`, `calendarRange.js`,
  `easternTime.js`, `basemap.js`.

## Routes (`backend/src/routes`, mounted in `index.js`)
Public (no auth): `/quote`, `/itinerary`. Auth-guarded `/api/*`: `scheduling`, `levelflight`,
`adsb`, `quotes`, `tripsheet`, `finances`, `maintenance`, `foreflight`, `assistant`, `agent`,
`rate-cards`. Auth = Supabase JWT, **ES256** — verify via `supabase.auth.getUser`, NOT
`jwt.verify` HS256.

## Conventions & gotchas (IMPORTANT — follow these)
- **Review diffs before push**: show the diff + a one-line diagnosis, wait for an explicit "push",
  then push. Don't push unprompted. Commits are co-authored.
- **Never print secrets** (`.env` values) or **real passenger PII** (names/DOB/passport) in tool
  output — use counts/structure only when probing data.
- **Backend renders documents** — keep quote/itinerary/trip-sheet data + rendering server-side.
- **Pax count = `leg.passengers.length`** (assignedPaxCount), not `passengerCount`.
- **Lead passenger = unique lowest seat.**
- **Supabase JWT is ES256** — verify via `supabase.auth.getUser`.
- **Migrations are manual** (user applies them in Supabase; no runner; no psql from Claude).
- Feature specs/plans live in `docs/superpowers/{specs,plans}/`.

## Dev commands
- Backend: `cd backend && npm run dev` (nodemon) | `npm start`.
- Backend tests: `node --test backend/src/scheduling/*.test.js backend/src/services/*.test.js`.
- Frontend: `cd frontend && npm run dev` | `npm run build`.
- Frontend lib tests: `node --test frontend/src/lib/*.test.js`.
