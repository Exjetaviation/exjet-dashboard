# Redesigned Charter Quote (PDF) — design

**Date:** 2026-06-17
**Status:** Approved (design)

## Problem

Exjet's client-facing charter quotes are generated inside LevelFlight and look
generic (flat blue bars, weak type, washed-out satellite map, big whitespace gaps).
The local "quote engine" (Supabase rate cards + AI email drafts) has been abandoned.
We want a **better-looking, branded quote** that pulls its data from **LevelFlight**,
shows the **flight path**, and is delivered as a **PDF** — generated from the
dashboard (auto-drafted on new trips + manual), with a working **"Request to Book"**
that uses LevelFlight's existing accept/sign flow.

This spec covers the **Quote** only. The **Trip Sheet** is a separate later
sub-project (it reuses this template foundation and adds crew/FBO/weather + a client
block).

## Goal

From a LevelFlight dispatch, produce a premium **"Midnight"** branded quote:
- Dark theme matching the dashboard; brushed-silver accent; real Exjet logo.
- Aircraft hero (tail, type, max pax, amenities, 3 photos).
- Multi-leg itinerary (airports + cities, dates/times, EFT, distance, pax).
- A **branded flight-path map** (dark tiles + great-circle route, the component we
  already built).
- Prominent **Total** (from LevelFlight pricing).
- Signature block + **"Request to Book"** linking to LevelFlight's accept page.
- **Terms & Conditions**: collapsible on screen, full final page in the PDF.
- Delivered as a **PDF** (download + email), generated on the dashboard, auto-drafted
  when a new trip appears and manually (re)generatable.

## Data sources (resolved via probes)

**From LevelFlight `POST /api/dispatch/list`** (read-only access is sufficient — we
only read + link, never write):
- **Total + line items** — `dispatch._internal.price.breakdown.calculatedTotal`
  (and `.total`), with breakdown (flightTime, crew, fuelSurcharge, FET, overnights,
  segment, etc.).
- **Legs** — airports, times, distance, pax (from the dispatch legs / scheduledLegs).
- **Aircraft** — tail, type.
- **Dispatch id** — `dispatch._id.$oid` (drives the Request-to-Book link; see below).

**Not from LevelFlight (handled locally):**
- **Quote number** — LevelFlight's isn't in the API; we generate our own sequence
  (e.g. `EXJET-####`) stored with the quote record. The dispatch id is the stable key.
- **Amenities** — from aircraft config (`/api/aircraft/{id}`) if available, else a
  per-tail default we store; v1 may use a simple per-aircraft amenities map.
- **Aircraft photos** — Exjet brand assets (the `N69FP interior/exterior/cabin`
  images), stored in the repo/app, keyed by tail.
- **Airport coordinates** for the map — from the leg data where present, else an
  airport-code→lat/lng lookup (same need as the flight-path work).
- **Terms & Conditions** — static Exjet boilerplate stored as a constant (full text
  in Appendix A). Same for every quote.

A quote is therefore a **view-model** assembled from a LevelFlight dispatch + local
additions (quote number, amenities, photos, T&C).

## "Request to Book" (resolved)

LevelFlight hosts a client accept/sign page at
`https://api.levelflight.com/client/<id>/accept` (redirects to
`https://ops.levelflight.com/client/<id>/accept`). `<id>` is a 24-char ObjectId — no
secret token — so the button is a **plain deep-link**; the client signs there and the
flight books **in LevelFlight**, exactly as today. We write nothing.

**Implementation must verify** which field yields `<id>`: confirm by matching the
accept-URL id against a live `/api/dispatch/list` payload — it is almost certainly the
dispatch `_id.$oid` or a sibling field on the dispatch record. If a dispatch lacks an
accept id, the button is disabled with a tooltip ("Booking link not available yet").

## Architecture

Three cohesive pieces (all new, in the existing app):

### 1. Backend — quote data + PDF service
- `backend/src/services/quoteData.js` (new) — `getQuoteViewModel(dispatchId)`: pulls
  the dispatch from LevelFlight, maps to the quote view-model (aircraft, legs, total +
  breakdown, accept-link id), merges local additions (amenities, photo refs). Pure-ish
  mapping kept in a tested helper (`mapDispatchToQuote`).
- `backend/src/templates/quoteHtml.js` (new) — renders the **Midnight quote HTML**
  from the view-model (server-side string template; the design we mocked). Includes
  the collapsible T&C for screen and an `expanded` flag for PDF.
- **PDF rendering — headless Chromium (Puppeteer).** `backend/src/services/quotePdf.js`
  (new) renders the quote HTML to PDF via Puppeteer so the flight-path map, fonts, and
  layout come out crisp and identical to the preview. The map loads CARTO tiles at
  render time; the renderer waits for network-idle (with a static-map fallback image
  if tiles fail, for robustness). *Deployment note:* Railway needs Chromium available
  to the backend (nixpacks/buildpack) — flagged as the one new infra dependency.
- `backend/src/routes/quotes.js` (extend) — endpoints:
  - `GET /api/quotes/list` → all quotes sourced from LevelFlight (`/api/dispatch/list`),
    mapped to summary rows: route, date(s), aircraft, pax, total, status, dispatch id,
    quote number. This backs the reused Quotes list page.
  - `GET /api/quotes/dispatch/:id/preview` → quote HTML (for the dashboard iframe/preview).
  - `GET /api/quotes/dispatch/:id/pdf` → the generated PDF (download/stream).
  - `POST /api/quotes/dispatch/:id/send` → email the PDF to the client (reuse existing Gmail send).
  - quote-number assignment + a `quotes` record (status: draft/sent) keyed by dispatch id.

### 2. Frontend — Quotes list + quote view
- **Quotes list (reuse `frontend/src/pages/Quotes.jsx`)** — repurpose the existing
  Quotes page to list **all LevelFlight quotes** (from `GET /api/quotes/list`): rows
  showing route, date(s), aircraft, pax, **total**, and status, with a status filter.
  This **replaces** the old email-parsed/rate-card quote list (that flow is abandoned).
  Clicking a row opens the quote view. Keep the page's look/placement; swap its data
  source and row click-through.
- **Quote view** — `frontend/src/pages/QuoteBuilder.jsx` (new, or a panel within
  `Quotes.jsx`): **live preview** of the branded quote (React render of the Midnight
  template, with the **live `FlightTrackMap`** and the **collapsible T&C**) →
  **Download PDF** / **Send to client** / copy **Request to Book** link.
- A shared `QuoteDocument.jsx` component renders the Midnight layout from the
  view-model and is the single source of truth the server template mirrors (so preview
  == PDF). Reuses `FlightTrackMap` for the route.

### 3. Automation (auto-draft + manual)
- A light reconciler (or hook into the existing dispatch sync) creates a **draft**
  quote record when a new dispatch appears in `/api/dispatch/list`, so it shows up on
  the dashboard ready to review. Manual **Generate / Regenerate** always available.
  No auto-send — ops reviews, then sends.

## Terms & Conditions behavior

- **On screen** (dashboard preview + any web view): a collapsed `<details>` accordion,
  expandable. Collapsed by default.
- **In the PDF**: rendered **expanded on a clean final page** (Puppeteer passes an
  `expanded`/print flag so the accordion is open and page-broken before it). Content =
  Appendix A verbatim.

## Data flow

New dispatch in LevelFlight → draft quote record created → it appears in the
**Quotes list** (reused `Quotes.jsx`, fed by `/api/quotes/list`) → ops opens it →
live Midnight preview (map + collapsible T&C) → Download PDF or Send to client (PDF
emailed) → client opens PDF → clicks **Request to Book** →
`api.levelflight.com/client/<id>/accept` → signs → booked in LevelFlight.

## Edge cases

- **Dispatch missing price** (`_internal.price` absent) → show the quote without a
  total and flag it in the dashboard ("price unavailable from LevelFlight"); don't
  fabricate a number.
- **Missing accept id** → Request-to-Book disabled with tooltip.
- **Missing photos/amenities for a tail** → omit the photo strip / amenity chips
  gracefully (layout still holds).
- **Map tiles fail in headless render** → fall back to a static route image so the PDF
  never ships with a blank map.
- **Multi-leg vs single-leg** → itinerary + map handle N legs (the sample is 3).
- **LevelFlight/Supabase down** → preview/PDF show a clear error; nothing crashes.

## Testing

- **Pure helpers** (`node:test`): `mapDispatchToQuote` (dispatch JSON → view-model:
  total, legs, aircraft, accept id, quote-number formatting), and any
  airport-coord/great-circle helper reused for the map.
- **PDF/template**: a smoke test that `quoteHtml` renders without throwing for a
  representative view-model; manual visual check of one generated PDF against the
  approved mockup.
- **Manual**: generate a real quote from a live dispatch → preview matches PDF →
  Request-to-Book opens the LevelFlight accept page → T&C collapses on screen and
  prints on the final PDF page.

## Open items to confirm during implementation

1. The exact dispatch field that yields the `client/<id>/accept` id (verify vs a live
   payload).
2. Whether amenities are reliably in `/api/aircraft/{id}`; if not, a small per-tail
   amenities map.
3. Railway Chromium availability for Puppeteer (infra setup).

## Files (anticipated)

- `backend/src/services/quoteData.js` (new) + `mapDispatchToQuote` helper + test
- `backend/src/templates/quoteHtml.js` (new)
- `backend/src/services/quotePdf.js` (new — Puppeteer)
- `backend/src/services/terms.js` (new — T&C constant, Appendix A)
- `backend/src/routes/quotes.js` (extend)
- `frontend/src/pages/Quotes.jsx` (modify — reuse as the LevelFlight quotes list)
- `frontend/src/components/QuoteDocument.jsx` (new — shared Midnight render)
- `frontend/src/pages/QuoteBuilder.jsx` (new — quote view/preview, or a panel in `Quotes.jsx`)
- brand assets: Exjet logo (trimmed) + per-tail aircraft photos

---

## Appendix A — Terms & Conditions (verbatim, stored as a constant)

**Late Passenger Policy:** If client / passenger(s) fail to arrive within 60 minutes
of departure time, the itinerary will be subject to cancellation by Exjet Aviation,
and will be subject to the cancellation policies outlined below.

**Cancellation Policy:** One-way reservations, including multi-leg / multi-day
one-ways, are subject to 100% of the estimated trip charges effective once confirmed.

Domestic round-trip reservations cancelled within:
- 72 hours of scheduled departure time are charged two flight hours at the current retail rate plus any set-up fees and aircraft positioning expenses.
- 48 hours of scheduled departure time are charged 50% of the estimated trip charges.
- 24 hours of scheduled departure time are charged 100% of the estimated trip charges.

International round-trip reservations cancelled within:
- 96 hours of scheduled departure time are charged 50% of the estimated trip charges.
- 48 hours of scheduled departure time are charged 100% of the estimated trip charges.

For all domestic flights, passengers are required to present a valid, current
government issued photo ID prior to departure. For all international flights,
passengers are required to obtain and present all applicable documentation and
identification prior to flight. For more information on required documentation for
international travel, please visit the Transportation Security Administration at
http://www.tsa.gov. Client will be liable for any and all penalties, fines or
additional costs associated with improperly documented passengers. If we are not able
to complete this trip because the passengers do not meet the US and/or Foreign
travel/admission requirements, you are subject to 100% of the contracted price. The
Transportation Security Administration of the U.S. Department of Homeland Security
requires us to collect information from you for purposes of Watch List screening,
under the authority of 49 U.S.C. section 114, and the Intelligence Reform and
Terrorism Prevention Act of 2004. Providing this information is voluntary; however, if
it is not provided, you may be subject to additional screening or denied transport or
authorization to enter a sterile area. TSA may share information you provide with law
enforcement or intelligence agencies or others under its published system of records
notice. For more on TSA Privacy policies, or to view the system of records notice and
the privacy impact assessment, please see TSA's Web site at www.tsa.gov.

Any peripheral costs that Exjet Aviation incurs in an attempt to meet the specific
requirements of a particular trip will be added to the quoted price including but not
limited to FBO special event fees, increased parking/ramp fees, aircraft de-icing,
hangar to prevent de-icing, international handling, aircraft cleaning,
catering/ground transportation or other requested services. Requested services such as
catering and ground transportation are subject to a 15% handling fee. Any unforeseen
additional flight time due to, but not limited to, weather events or air traffic
control delays and/or routings could be billed at completion of flight.
International/Satellite-based WIFI will be charged at cost. Ask your Charter Sales
representative if this aircraft is equipped with satellite-based WIFI and what the cost
is for this aircraft. The itinerary shown on this contract includes all flight legs
agreed upon. There is no implied or expressed ownership by the undersigned of any
flight legs not shown on this contract, regardless of the price paid. Exjet Aviation
reserves the right to cancel due to circumstances beyond our control. Such
circumstances would include inclement weather, unscheduled maintenance or safety
concerns.

**Signature above acknowledges the following:** I am signing as an authorized
representative for the quoted trip above and the arrangements made for the trip are
satisfactory and the QUOTE is acceptable. I have read and agree to abide by Exjet
Aviation's scheduling & cancellation policy. I understand that payment is due upon
receipt of invoice. I understand the invoice will be subject to late charges of 1.5%
per month on unpaid balances of undisputed charges 30 days or more past due. I will pay
all costs of collection, including attorney's fees. As the acting indirect air carrier,
I certify that I will disclose all necessary information with the charterer in
compliance with Federal Aviation Regulations Part 295 and hold Exjet Aviation harmless
if those disclosures are not made. Should legal action become necessary, I agree to
abide by the laws of the State of Florida. Client agrees that payment in full will be
made by wire transfer prior to the end of the previous business day. Client
acknowledges that credit card information is required and authorization obtained on the
credit card below is valid until paid in full. If any additional charges are incurred,
Exjet Aviation may charge the credit card given by the client. Any hold of funds or
charges made on the credit card will have a 4% processing fee added to the total
amount.
