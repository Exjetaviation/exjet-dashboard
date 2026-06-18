# Crew Trip Sheet (Flight Release) — design

**Date:** 2026-06-18
**Status:** Approved (design)

## Problem

Crews need the operational **Flight Release / Trip Sheet** for a trip — call signs,
per-leg times, comms frequencies, FBOs, fuel burn, METARs, aircraft maintenance/
currency status, crew details, and the passenger manifest (with weights/passports).
This is distinct from the client-facing **Passenger Itinerary** (already shipped). It
is operationally dense and contains PII, so it must stay behind the dashboard login.

LevelFlight already produces this exact document (it's the emailed
"Trip Sheet … from EXJET AVIATION.pdf"). Rebuilding it from the structured API is not
viable: maintenance/currency status, crew DOB/weight, and the passport manifest are
**not exposed** by the documented endpoints.

## Key finding (verified live)

The authenticated endpoint **`GET /api/dispatch/{id}/release`** returns the **complete
trip sheet as HTML (~67 KB)** containing every section — Flight Release header, Trip #,
**METARs**, **Currency/Maintenance status**, **passenger manifest**, comms, FBOs, and
crew. It is the source of the emailed PDF and is already **Exjet-branded** and
operational print-dense. The structured `review/tripSheet` JSON exposes this link as
its `url` field (`…/dispatch/{id}/release`) with `subject` = "Trip Sheet … from EXJET
AVIATION".

This removes the data-gap problem entirely. We **proxy** that document rather than
rebuild it. ForeFlight / aviationweather are therefore unnecessary for v1.

## Goal

From a flight's detail page, an authenticated crew user can **View** and **Download a
PDF of** the official LevelFlight Flight Release for that flight's trip — complete,
accurate, always in sync with LevelFlight, and never exposed publicly.

## Decisions (resolved during brainstorming)
- **Source:** proxy LevelFlight's `/api/dispatch/{id}/release` HTML (Approach A), not a
  rebuild.
- **Style:** the release document is already operational print-dense and Exjet-branded —
  served as-is, no restyle.
- **Access:** authenticated dashboard only — **View + Download PDF**. No public link, no
  Copy-link (PII).
- **Entry point:** a Trip Sheet action on the flight detail page (`FlightDetail.jsx`),
  beside the existing itinerary actions, keyed by the leg's `dispatch._id`.
- **View mechanism:** because the route is behind the `/api` auth guard, a plain
  new-tab link would arrive without the Bearer token (401). View therefore **fetches
  the HTML via `apiFetch` and renders it inline in a modal iframe** (`srcDoc`);
  Download PDF fetches a blob via `apiFetch` (same pattern as the quote download).

## Architecture

### 1. Backend service — `services/tripSheet.js`
`fetchReleaseHtml(dispatchId)`: GET `/api/dispatch/{id}/release` using the existing
LevelFlight token plumbing in `levelflight.js` (add an exported helper there, or reuse
its authed axios client). Returns the HTML string. Throws / returns null on a non-200
so the route can 404. Also expose `getReleaseMeta(dispatchId)` (optional) to read the
`subject`/`tripId` from `review/tripSheet` for the PDF filename — or derive the trip
number from the already-available dispatch data.

Implementation note: add `getDispatchRelease(dispatchOid)` to `levelflight.js`
(mirrors `getTripLog`) returning the release HTML, so all LevelFlight HTTP stays in
that module.

### 2. Routes — `routes/tripSheet.js`, mounted UNDER the `/api` auth guard
- `GET /api/tripsheet/:id` → `res.type('html').send(await fetchReleaseHtml(id))`; 404
  when LevelFlight has no release for that dispatch.
- `GET /api/tripsheet/:id/pdf` → `renderQuotePdf(html)` (the existing HTML-agnostic
  Puppeteer renderer), `Content-Disposition: inline; filename="Trip Sheet <trip#>.pdf"`.
Mounted in `index.js` as `app.use('/api/tripsheet', tripSheetRoutes)` AFTER the
`requireAuth` guard (contrast with the public `/itinerary` mount).

### 3. Frontend — `FlightDetail.jsx`
Add a **Trip Sheet** group next to View itinerary / Download PDF:
- **View trip sheet** → `apiFetch('/api/tripsheet/<dispatchId>')` → `.text()` → open a
  full-screen modal containing `<iframe srcDoc={html}>` with a close button.
- **Download PDF** → `apiFetch('/api/tripsheet/<dispatchId>/pdf')` → `.blob()` →
  object-URL download named `Trip Sheet <trip#>.pdf` (reuse the quote-download pattern).
- Disabled/hidden when the leg has no `dispatch._id`.
- A small inline error line if the fetch fails (e.g. "Trip sheet unavailable").

## Data flow
Crew opens a flight → FlightDetail → clicks **View trip sheet** → dashboard
`apiFetch`es `/api/tripsheet/<dispatchId>` (token attached) → backend fetches
LevelFlight `/release` HTML → rendered in a modal iframe. **Download PDF** runs the
same HTML through Puppeteer and downloads it. Everything stays inside the authed
dashboard.

## Edge cases
- **Unknown dispatch / no release yet** (e.g. an unreleased trip) → backend 404; the
  frontend shows "Trip sheet not available for this trip yet."
- **Leg with no `dispatch._id`** → action hidden.
- **LevelFlight token/HTTP failure** → 502/500 with a JSON error; frontend shows an
  inline failure message (no crash).
- **Self-contained HTML** (verified): the release uses inline `style` attributes with
  **no external CSS/JS/images**, so it renders identically in the iframe and Puppeteer
  with no authed-asset problem. The PDF renderer must NOT block on the quote's
  `window.__mapReady` flag (the release never sets it) — add an opt-out so the trip
  sheet prints immediately after `networkidle0`.
- **PII** → never exposed publicly; the route is auth-guarded and the View is in-app.

## Testing
- Backend: pure unit test of `fetchReleaseHtml`'s status handling via an injected
  fetcher (e.g. `fetchReleaseHtml(id, { client })` accepting an axios-like client) so
  it's testable without the network — 200 → returns HTML; non-200 → returns null.
  `node --check` on new/changed files; existing suites pass. (Express route wiring is
  covered by the live check below rather than ESM module mocking.)
- Live (uses backend creds, structure-only logging — no PII printed): `fetchReleaseHtml`
  on a real operational dispatch returns HTML containing the section markers
  (Flight Release / Trip # / METAR / Currency / Passengers); the PDF route returns a
  `%PDF` buffer of nonzero length.
- Frontend: `npm run build` clean. Manual: open a flight → View trip sheet renders the
  full release in the modal; Download PDF downloads the document; both require login.

## Files touched
- `backend/src/services/levelflight.js` (modify — add `getDispatchRelease(oid)`)
- `backend/src/services/tripSheet.js` (new — `fetchReleaseHtml(dispatchId)`)
- `backend/src/routes/tripSheet.js` (new — authed `/api/tripsheet/:id` + `/pdf`)
- `backend/src/routes/tripSheet.test.js` (new — route passthrough/404 with stub)
- `backend/src/index.js` (modify — mount `/api/tripsheet` under the auth guard)
- `frontend/src/pages/FlightDetail.jsx` (modify — Trip Sheet View + Download PDF, modal)
