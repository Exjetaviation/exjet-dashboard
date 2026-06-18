# Public client-facing web quote + route plane animation — design

**Date:** 2026-06-17
**Status:** Approved (design)

## Problem

The redesigned quote currently lives in two forms: a dashboard preview (auth-guarded
iframe) and an emailed PDF. A PDF can't be interactive — the collapsible Terms &
Conditions can't "tap to expand," and there's no motion. We want to give clients a
**live web link** to the quote (like LevelFlight's client pages) where everything
works: the T&C dropdown, and a small looping plane animation along the route map.

## Goal

- A **public, client-accessible web URL** for any quote — no dashboard login.
- On that page: the branded interactive quote with a **working tap-to-expand T&C**, a
  **plane animation looping the route**, a **Request to Book** button, and a
  **Download PDF** button.
- From the dashboard: a **Copy client link** button and an **Email link** action.
- Reuse the existing single HTML renderer — no duplicate templates, no new data
  sources.

## Decisions (resolved during brainstorming)

- **Access:** public link keyed by **dispatch id** — `/quote/<dispatchId>`. The
  24-char id is the access token (same model as LevelFlight's client links). No token
  store.
- **Page content:** quote + Request to Book + **Download PDF**.
- **Delivery:** **both** a Copy-client-link button and an Email-link action.

## Architecture

### 1. Shared view-model builder
Extract `buildViewModel(dispatchId)` from `backend/src/routes/quotes.js` into
`backend/src/services/quoteData.js` (exported), so the authed dashboard routes and the
new public routes call the identical builder + renderer. `ACCEPT_BASE` moves with it.

### 2. Public, unauthenticated routes
`backend/src/routes/publicQuotes.js` (new), mounted in `index.js` **before** the
`/api` `requireAuth` guard (the same pattern as the existing OAuth-callback
exemptions):
- `GET /quote/:id` → `renderQuoteHtml(vm, { print: false, web: true })` — interactive
  HTML (collapsible T&C, animated map, Request to Book, Download PDF button).
- `GET /quote/:id/pdf` → `renderQuotePdf(renderQuoteHtml(vm, { print: true }))` — so the
  client's Download button works without login.
Both return 404 (plain) when the dispatch isn't found. They expose only client-facing
quote content (route, aircraft, price, terms) — no dashboard data.

### 3. Plane animation on the route map
Add a looping, rotating plane marker to the inline map script in
`backend/src/services/quoteHtml.js`, mirroring `FlightTrackMap`:
- Concatenate the drawn leg segments into one ordered path.
- `requestAnimationFrame` loop interpolates a plane `L.marker` (a rotated SVG divIcon)
  along the path over a fixed ~6s loop, facing the direction of travel (segment
  bearing). Guard when there are <1 segments (no coords → no plane).
- Because there's one renderer, the animation shows on the dashboard preview and the
  public page. In the PDF, Puppeteer captures a single frame (plane at/near the
  start) — acceptable as a static plane on the map.

### 4. `renderQuoteHtml` gains a `web` flag
When `web: true`, render a slim top action bar with a **Download PDF** link whose
href is passed in on the view-model (`vm.pdfUrl`, set to the absolute
`/quote/<id>/pdf` by the public route) — `print` mode is unchanged. The `web` page is
`print: false`, so the `<details>` T&C is collapsed and expandable.

### 5. Dashboard (Quotes page)
On the selected quote, add two actions next to Download PDF:
- **Copy client link** — copies `${API_BASE}/quote/${dispatchId}` to the clipboard.
- **Email link** — prompts for the client email (not reliably in LevelFlight; can be
  pulled via `customer-get` later) and sends the link via the existing Gmail
  `sendEmail`, through a small authed endpoint `POST /api/quotes/dispatch/:id/send-link`
  (`{ to }`) that emails the public URL.

## Data flow

Ops opens a quote on the dashboard → clicks **Copy client link** (or **Email link**) →
client opens `https://<backend>/quote/<id>` (no login) → sees the interactive quote
(animated route, tap-to-expand T&C) → clicks **Request to Book** (LevelFlight accept
page) or **Download PDF** (`/quote/<id>/pdf`).

## Edge cases
- **Unknown/invalid id** → 404 page (both `/quote/:id` and `/pdf`).
- **No leg coords** → map shows "route map unavailable" and no plane (existing guard).
- **Public exposure:** the link is unauthenticated by design; the id is unguessable
  and the page shows only client-appropriate content. (A revocable token can be added
  later if needed.)
- **PDF from public route** runs Puppeteer the same way as the authed route (same
  Chromium dependency already deployed).

## Testing
- Build/lint clean (`npm run build`, eslint on changed frontend).
- Backend `node --check` on new/changed files; existing `node:test` suites still pass.
- Manual: open `/quote/<id>` **logged out** → interactive quote renders with the
  looping plane, T&C expands on tap, Download PDF returns the PDF, Request to Book
  opens the LevelFlight accept page; dashboard Copy-link and Email-link work.

## Files touched
- `backend/src/services/quoteData.js` (new — shared `buildViewModel` + `ACCEPT_BASE`)
- `backend/src/routes/quotes.js` (modify — import shared builder; add `send-link` endpoint)
- `backend/src/routes/publicQuotes.js` (new — public `/quote/:id` + `/quote/:id/pdf`)
- `backend/src/index.js` (modify — mount public router before the auth guard)
- `backend/src/services/quoteHtml.js` (modify — `web` action bar + plane animation)
- `frontend/src/pages/Quotes.jsx` (modify — Copy-link + Email-link buttons)
