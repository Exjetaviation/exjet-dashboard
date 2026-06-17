# Redesigned Charter Quote (PDF) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a premium, branded ("Midnight") charter-quote PDF from LevelFlight dispatch data, listed on a reused Quotes page, previewed on the dashboard, emailed to clients, with a "Request to Book" deep-link into LevelFlight's accept/sign flow.

**Architecture:** The backend builds a quote **view-model** from a LevelFlight dispatch (`/api/dispatch/list`), renders it to **one self-contained HTML document** (`quoteHtml.js` — the Midnight design, inline assets, a Leaflet map from CDN). The dashboard shows that HTML in an **iframe** (preview, with collapsible T&C); **Puppeteer** renders the same HTML (with `?print=1`) to **PDF**. The reused `Quotes.jsx` lists LevelFlight quotes. Single renderer = preview matches PDF.

**Tech Stack:** Node/Express (ESM), Supabase, Puppeteer (new), Leaflet via CDN (in the rendered doc), React + Vite, `node:test`.

**Reference:** Spec `docs/superpowers/specs/2026-06-17-quote-pdf-redesign-design.md` (Appendix A has the verbatim T&C). The approved visual design lives at `.superpowers/brainstorm/18621-1781737206/content/quote-final.html` — mirror its layout/colors.

---

## File Structure

**Backend**
- `backend/src/services/levelflight.js` (modify) — add `getDispatchList(page)` → `POST /api/dispatch/list`.
- `backend/src/services/quoteMap.js` (new) — PURE `mapDispatchToQuote(dispatch)` → view-model. Unit-tested.
- `backend/src/services/quoteTerms.js` (new) — the T&C constant (Appendix A text).
- `backend/src/assets/quote/` (new) — brand assets: `logo.png` (trimmed white logo), per-tail photos (`N69FP-interior.jpeg`, etc.) + `assets.js` loader returning data URIs.
- `backend/src/services/quoteHtml.js` (new) — `renderQuoteHtml(viewModel, { print })` → self-contained HTML string (Midnight design + Leaflet-CDN map).
- `backend/src/services/quotePdf.js` (new) — `renderQuotePdf(html)` via Puppeteer.
- `backend/src/routes/quotes.js` (modify) — add list/preview/pdf/send-pdf endpoints.

**Frontend**
- `frontend/src/pages/Quotes.jsx` (modify) — reuse as the LevelFlight quotes list + quote view (iframe preview + actions).

---

## Task 1: LevelFlight `getDispatchList`

**Files:** Modify `backend/src/services/levelflight.js`

- [ ] **Step 1: Add the function** (append after `getDutyTimes`, mirroring the existing POST helpers):

```js
export const getDispatchList = async (page = 1) => {
  const client = await lf();
  const res = await client.post('/api/dispatch/list', { page });
  return res.data; // { success, message, dispatches, page }
};
```

- [ ] **Step 2: Syntax check**

Run: `cd backend && node --check src/services/levelflight.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/levelflight.js
git commit -m "Add LevelFlight getDispatchList (POST /api/dispatch/list)"
```

---

## Task 2: Pure `mapDispatchToQuote` + tests

**Files:** Create `backend/src/services/quoteMap.js`, `backend/src/services/quoteMap.test.js`

**Context:** A LevelFlight dispatch carries `_id.$oid`, `_internal.price.breakdown.calculatedTotal` (+ `.total`), `aircraft` (tail/type), and legs (departure/arrival airports, times, distance, pax). The view-model is what the HTML renderer consumes. Times are epoch ms. The accept-link id is the dispatch `_id.$oid` (verified in Task 6 against live data; the mapper reads it from there with a fallback to `dispatch.clientAcceptId` if present).

- [ ] **Step 1: Write the failing test**

```js
// backend/src/services/quoteMap.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapDispatchToQuote } from './quoteMap.js';

const dispatch = {
  _id: { $oid: '69fb575a2900002600b1e1bd' },
  aircraft: { tailNumber: 'N69FP', type: { name: 'Gulfstream GIV-SP' } },
  _internal: { price: { breakdown: { calculatedTotal: 232105 }, total: 232105 } },
  legs: [
    { departure: { airport: 'EHAM', time: 1000 }, arrival: { airport: 'LGAV', time: 2000 }, distance: 1179, pax: 15 },
    { departure: { airport: 'LGAV', time: 3000 }, arrival: { airport: 'LGKR', time: 4000 }, distance: 214, pax: 15 },
  ],
};

test('maps tail, type, total and accept id', () => {
  const q = mapDispatchToQuote(dispatch);
  assert.equal(q.tail, 'N69FP');
  assert.equal(q.aircraftType, 'Gulfstream GIV-SP');
  assert.equal(q.total, 232105);
  assert.equal(q.acceptId, '69fb575a2900002600b1e1bd');
  assert.equal(q.dispatchId, '69fb575a2900002600b1e1bd');
});

test('maps legs with airports, times, distance, pax', () => {
  const q = mapDispatchToQuote(dispatch);
  assert.equal(q.legs.length, 2);
  assert.deepEqual(
    { from: q.legs[0].from, to: q.legs[0].to, dep: q.legs[0].depTime, arr: q.legs[0].arrTime, dist: q.legs[0].distance, pax: q.legs[0].pax },
    { from: 'EHAM', to: 'LGAV', dep: 1000, arr: 2000, dist: 1179, pax: 15 },
  );
});

test('total is null when LevelFlight has no price (do not fabricate)', () => {
  const q = mapDispatchToQuote({ ...dispatch, _internal: {} });
  assert.equal(q.total, null);
});

test('prefers explicit clientAcceptId when present', () => {
  const q = mapDispatchToQuote({ ...dispatch, clientAcceptId: 'abc123' });
  assert.equal(q.acceptId, 'abc123');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && node --test src/services/quoteMap.test.js`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```js
// backend/src/services/quoteMap.js
// Pure mapper: LevelFlight dispatch -> quote view-model the renderer consumes.
// No I/O. The dollar total is taken ONLY from LevelFlight; null when absent
// (never fabricated). acceptId drives the LevelFlight client accept/sign link.

const oid = (v) => (v && typeof v === 'object' ? v.$oid : v) || null;

export function mapDispatchToQuote(d) {
  const dispatchId = oid(d?._id);
  const total = d?._internal?.price?.breakdown?.calculatedTotal
    ?? d?._internal?.price?.total
    ?? null;
  const legs = (d?.legs || []).map((l) => ({
    from: l?.departure?.airport ?? null,
    to: l?.arrival?.airport ?? null,
    depTime: l?.departure?.time ?? null,
    arrTime: l?.arrival?.time ?? null,
    distance: l?.distance ?? null,
    pax: l?.pax ?? l?.passengers ?? null,
  }));
  return {
    dispatchId,
    acceptId: d?.clientAcceptId || dispatchId,
    tail: d?.aircraft?.tailNumber ?? null,
    aircraftType: d?.aircraft?.type?.name ?? null,
    total,
    legs,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && node --test src/services/quoteMap.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/quoteMap.js backend/src/services/quoteMap.test.js
git commit -m "Add pure mapDispatchToQuote view-model mapper + tests"
```

---

## Task 3: T&C constant + brand assets loader

**Files:** Create `backend/src/services/quoteTerms.js`, `backend/src/assets/quote/assets.js`, and copy asset files.

- [ ] **Step 1: Create the T&C constant**

Create `backend/src/services/quoteTerms.js` exporting `QUOTE_TERMS_HTML` — the verbatim text from spec Appendix A as an HTML string (sections wrapped in `<p>`/`<ul>`). Paste the full Appendix A text. Example shape (fill with the complete Appendix A copy):

```js
// backend/src/services/quoteTerms.js
// Exjet's standard charter T&C (boilerplate; same for every quote). Verbatim from
// the design spec Appendix A. Rendered collapsed on screen, expanded in the PDF.
export const QUOTE_TERMS_HTML = `
<p class="t-h">Late Passenger Policy</p>
<p>If client / passenger(s) fail to arrive within 60 minutes of departure time, the itinerary will be subject to cancellation by Exjet Aviation, and will be subject to the cancellation policies outlined below.</p>
<p class="t-h">Cancellation Policy</p>
<p>One-way reservations, including multi-leg / multi-day one-ways, are subject to 100% of the estimated trip charges effective once confirmed.</p>
<p>Domestic round-trip reservations cancelled within: 72 hours — two flight hours at the current retail rate plus set-up fees and aircraft positioning; 48 hours — 50% of estimated trip charges; 24 hours — 100% of estimated trip charges.</p>
<p>International round-trip reservations cancelled within: 96 hours — 50% of estimated trip charges; 48 hours — 100% of estimated trip charges.</p>
<p>For all domestic flights, passengers are required to present a valid, current government issued photo ID prior to departure. For all international flights, passengers are required to obtain and present all applicable documentation and identification prior to flight (see the TSA at http://www.tsa.gov). Client will be liable for any and all penalties, fines or additional costs associated with improperly documented passengers. If we are not able to complete this trip because the passengers do not meet the US and/or Foreign travel/admission requirements, you are subject to 100% of the contracted price. The TSA of the U.S. Department of Homeland Security requires us to collect information for Watch List screening under 49 U.S.C. section 114 and the Intelligence Reform and Terrorism Prevention Act of 2004; providing it is voluntary, but without it you may be subject to additional screening or denied transport. See TSA privacy policy at www.tsa.gov.</p>
<p>Any peripheral costs that Exjet Aviation incurs to meet the specific requirements of a particular trip will be added to the quoted price including but not limited to FBO special event fees, increased parking/ramp fees, aircraft de-icing, hangar to prevent de-icing, international handling, aircraft cleaning, catering/ground transportation or other requested services. Requested services such as catering and ground transportation are subject to a 15% handling fee. Any unforeseen additional flight time due to weather events or air traffic control delays and/or routings could be billed at completion of flight. International/Satellite-based WIFI will be charged at cost. The itinerary shown on this contract includes all flight legs agreed upon. There is no implied or expressed ownership by the undersigned of any flight legs not shown on this contract, regardless of the price paid. Exjet Aviation reserves the right to cancel due to circumstances beyond our control, including inclement weather, unscheduled maintenance or safety concerns.</p>
<p class="t-h">Signature above acknowledges the following</p>
<p>I am signing as an authorized representative for the quoted trip above and the arrangements made for the trip are satisfactory and the QUOTE is acceptable. I have read and agree to abide by Exjet Aviation's scheduling &amp; cancellation policy. I understand that payment is due upon receipt of invoice, with late charges of 1.5% per month on unpaid undisputed balances 30+ days past due, plus costs of collection including attorney's fees. As the acting indirect air carrier, I certify that I will disclose all necessary information in compliance with Federal Aviation Regulations Part 295 and hold Exjet Aviation harmless if those disclosures are not made. Should legal action become necessary, I agree to abide by the laws of the State of Florida. Client agrees that payment in full will be made by wire transfer prior to the end of the previous business day. Client acknowledges that credit card information is required and authorization obtained is valid until paid in full; any hold of funds or charges made on the credit card will have a 4% processing fee added to the total.</p>
`;
```

(Verify the wording matches spec Appendix A — it is the legally-relevant copy.)

- [ ] **Step 2: Add the brand assets + loader**

Copy the trimmed logo and the three N69FP photos into `backend/src/assets/quote/`:
```bash
mkdir -p backend/src/assets/quote
cp /tmp/exjet_logo_trim.png backend/src/assets/quote/logo.png
cp ~/Downloads/"N69FP interior.jpeg" backend/src/assets/quote/N69FP-interior.jpeg
cp ~/Downloads/"N69FP exterior.jpeg" backend/src/assets/quote/N69FP-exterior.jpeg
cp ~/Downloads/"N69FP cabin.jpeg"    backend/src/assets/quote/N69FP-cabin.jpeg
```

Create `backend/src/assets/quote/assets.js`:
```js
// backend/src/assets/quote/assets.js
// Loads brand assets as data URIs for the self-contained quote HTML (so Puppeteer
// and the iframe preview need no static asset serving). Per-tail photos keyed by tail.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const uri = (file, mime) => {
  try { return `data:${mime};base64,${readFileSync(join(here, file)).toString('base64')}`; }
  catch { return null; }
};

export const LOGO_DATA_URI = uri('logo.png', 'image/png');

// { tail: { interior, exterior, cabin } } — extend as photos are added.
export function aircraftPhotos(tail) {
  const t = String(tail || '').toUpperCase();
  if (t === 'N69FP') return {
    interior: uri('N69FP-interior.jpeg', 'image/jpeg'),
    exterior: uri('N69FP-exterior.jpeg', 'image/jpeg'),
    cabin: uri('N69FP-cabin.jpeg', 'image/jpeg'),
  };
  return { interior: null, exterior: null, cabin: null };
}
```

- [ ] **Step 3: Syntax check + commit**

Run: `cd backend && node --check src/services/quoteTerms.js && node --check src/assets/quote/assets.js`
```bash
git add backend/src/services/quoteTerms.js backend/src/assets/quote
git commit -m "Add quote T&C constant and brand asset loader (logo + N69FP photos)"
```

---

## Task 4: `quoteHtml.js` — render the Midnight document

**Files:** Create `backend/src/services/quoteHtml.js`

**Context:** Produce ONE self-contained HTML string (mirrors `.superpowers/brainstorm/18621-1781737206/content/quote-final.html`). Inline CSS, inline images (data URIs from assets.js), and a Leaflet map (CDN) initialized from leg airport coords. `print=true` → T&C `<details open>` + a page-break before it. Airport coords come from `viewModel.legs[].fromLatLng/toLatLng` (resolved in Task 6 via an airport lookup); if coords are missing, the map shows a "route map unavailable" panel.

- [ ] **Step 1: Implement `renderQuoteHtml`**

Create `backend/src/services/quoteHtml.js`:

```js
// backend/src/services/quoteHtml.js
// Renders a quote view-model to a self-contained "Midnight" HTML document used for
// BOTH the dashboard iframe preview and the Puppeteer PDF (single source of truth).
import { LOGO_DATA_URI, aircraftPhotos } from '../assets/quote/assets.js';
import { QUOTE_TERMS_HTML } from './quoteTerms.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 }));
const fmtDT = (ms) => (ms == null ? '' : new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));

function legRow(leg, i) {
  return `<div class="leg">
    <div class="legno">${i + 1}</div>
    <div class="legdate">${esc(fmtDT(leg.depTime))}</div>
    <div class="legroute">
      <div><div class="apt">${esc(leg.from)}</div></div>
      <div class="line"><span class="plane">&#9992;</span></div>
      <div style="text-align:right"><div class="apt">${esc(leg.to)}</div></div>
    </div>
    <div class="legmeta">${leg.pax != null ? esc(leg.pax) + ' PAX' : ''}<br>${leg.distance != null ? esc(leg.distance) + ' nm' : ''}</div>
  </div>`;
}

// Leaflet polylines for each leg (great-circle-ish straight segments) + markers.
function mapScript(viewModel) {
  const pts = viewModel.legs
    .filter((l) => l.fromLatLng && l.toLatLng)
    .map((l) => [l.fromLatLng, l.toLatLng]);
  return `
    const segs = ${JSON.stringify(pts)};
    if (segs.length) {
      const map = L.map('map', { zoomControl: false, attributionControl: false });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19 }).addTo(map);
      const all = [];
      segs.forEach((s) => {
        L.polyline(s, { color: '#38bdf8', weight: 2, opacity: 0.85 }).addTo(map);
        s.forEach((p) => { L.circleMarker(p, { radius: 4, color: '#fff', fillColor: '#38bdf8', fillOpacity: 1 }).addTo(map); all.push(p); });
      });
      map.fitBounds(L.latLngBounds(all), { padding: [24, 24] });
      window.__mapReady = false;
      map.whenReady(() => setTimeout(() => { window.__mapReady = true; }, 600));
    } else { window.__mapReady = true; document.getElementById('map').innerHTML = '<div class=\"nomap\">Route map unavailable</div>'; }
  `;
}

export function renderQuoteHtml(vm, { print = false } = {}) {
  const photos = aircraftPhotos(vm.tail);
  const photoImg = (src, alt) => src ? `<img src="${src}" alt="${alt}" class="acimg">` : '';
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,Segoe UI,Roboto,sans-serif; color:#e8edf4; background:#0b1018; }
  .page { max-width:760px; margin:0 auto; }
  .hdr { display:flex; justify-content:space-between; align-items:flex-start; padding:26px 30px 18px; }
  .logo { height:62px; }
  .addr { font-size:10px; color:#6b7890; margin-top:12px; line-height:1.6; }
  .qmeta { text-align:right; font-size:11px; color:#8a98ad; line-height:1.7; }
  .qlabel { font-size:13px; letter-spacing:4px; color:#c4ced9; }
  .rule { height:1px; background:linear-gradient(90deg,transparent,#aab4c2,transparent); }
  .hero { display:flex; gap:18px; padding:22px 30px; align-items:center; }
  .tail { font-size:30px; font-weight:700; color:#fff; }
  .type { font-size:12px; color:#c4ced9; letter-spacing:1px; }
  .chips span { font-size:10px; border:1px solid #2a3852; border-radius:20px; padding:3px 10px; color:#cfe0f5; margin-right:6px; }
  .acimg { flex:1; min-width:0; height:96px; object-fit:cover; border-radius:7px; border:1px solid #233247; }
  .photos { flex:1; display:flex; gap:8px; }
  .sec { font-size:10px; letter-spacing:3px; color:#6b7890; margin:0 30px 6px; }
  .leg { display:flex; align-items:center; gap:16px; padding:13px 30px; border-bottom:1px solid #1a2638; }
  .legno { width:18px; color:#c4ced9; font-weight:700; }
  .legdate { width:130px; font-size:11px; color:#8a98ad; }
  .legroute { flex:1; display:flex; align-items:center; gap:10px; }
  .apt { font-size:18px; font-weight:600; color:#fff; }
  .line { flex:1; height:1px; background:linear-gradient(90deg,#38bdf8,#2a3852); position:relative; }
  .plane { position:absolute; right:0; top:-8px; color:#38bdf8; }
  .legmeta { width:90px; text-align:right; font-size:10px; color:#8a98ad; }
  #map { margin:14px 30px; height:170px; border-radius:9px; border:1px solid #233247; background:#0a0f18; }
  .nomap { display:flex; height:100%; align-items:center; justify-content:center; color:#5b6b82; font-size:12px; }
  .total { display:flex; justify-content:space-between; align-items:center; margin:0 30px; padding:16px 22px; border-radius:9px; background:linear-gradient(90deg,#1a2436,#0c1422); border:1px solid #8893a5; }
  .total .l { font-size:12px; letter-spacing:3px; color:#c4ced9; } .total .v { font-size:28px; font-weight:700; color:#fff; }
  .terms { margin:14px 30px 0; } .terms details { border:1px solid #243149; border-radius:9px; background:#0e1622; }
  .terms summary { cursor:pointer; list-style:none; padding:13px 16px; font-size:11px; letter-spacing:2px; color:#c4ced9; }
  .terms .body { padding:2px 16px 16px; border-top:1px solid #1a2638; font-size:10px; line-height:1.6; color:#aeb9c9; }
  .terms .t-h { color:#e8edf4; font-weight:600; margin:12px 0 3px; }
  .sign { display:flex; gap:24px; padding:18px 30px 10px; } .sign div { flex:1; } .sign .ln { height:1px; background:#33425c; } .sign .lbl { font-size:10px; color:#8a98ad; margin-top:5px; }
  .cta { margin:8px 30px 26px; padding:14px; text-align:center; border-radius:9px; background:linear-gradient(90deg,#cfd6e0,#aab4c2); color:#0b1018; font-weight:700; letter-spacing:3px; font-size:13px; text-decoration:none; display:block; }
  ${print ? '.terms{break-before:page;} .terms summary span:last-child{display:none;}' : ''}
</style></head>
<body><div class="page">
  <div class="hdr">
    <div>${LOGO_DATA_URI ? `<img class="logo" src="${LOGO_DATA_URI}" alt="Exjet">` : '<div class="tail">EXJET</div>'}
      <div class="addr">4250 Execuair Street, Suite G · Orlando, FL 32827<br>+1 (407) 677-7792</div></div>
    <div class="qmeta"><div class="qlabel">CHARTER QUOTE</div>
      <div style="margin-top:10px">Quote <span style="color:#fff;font-weight:600">${esc(vm.quoteNumber || '—')}</span><br>${esc(vm.preparedBy || '')}<br>${esc(vm.preparedOn || '')}</div></div>
  </div>
  <div class="rule"></div>
  <div class="hero">
    <div style="flex:0 0 200px"><div class="tail">${esc(vm.tail || '')}</div><div class="type">${esc(vm.aircraftType || '')}</div>
      ${vm.maxPax ? `<div style="font-size:11px;color:#8a98ad;margin-top:8px">Max ${esc(vm.maxPax)} passengers</div>` : ''}
      <div class="chips" style="margin-top:10px">${(vm.amenities || []).map((a) => `<span>${esc(a)}</span>`).join('')}</div></div>
    <div class="photos">${photoImg(photos.interior, 'interior')}${photoImg(photos.exterior, 'exterior')}${photoImg(photos.cabin, 'cabin')}</div>
  </div>
  <div class="sec">ITINERARY</div>
  ${vm.legs.map(legRow).join('')}
  <div id="map"></div>
  <div class="total"><span class="l">TOTAL</span><span class="v">${money(vm.total)}</span></div>
  <div class="terms"><details ${print ? 'open' : ''}><summary><span>TERMS &amp; CONDITIONS</span><span style="float:right;color:#8893a5">tap to expand &#9662;</span></summary><div class="body">${QUOTE_TERMS_HTML}</div></details></div>
  <div class="sign"><div><div class="ln"></div><div class="lbl">Accepted by</div></div><div><div class="ln"></div><div class="lbl">Print name</div></div><div style="flex:0 0 130px"><div class="ln"></div><div class="lbl">Date</div></div></div>
  ${vm.acceptUrl ? `<a class="cta" href="${esc(vm.acceptUrl)}">REQUEST TO BOOK &#8594;</a>` : '<div class="cta" style="opacity:.5">BOOKING LINK UNAVAILABLE</div>'}
</div>
<script>${mapScript(vm)}</script>
</body></html>`;
}
```

- [ ] **Step 2: Syntax check + smoke render**

Run:
```bash
cd backend && node --check src/services/quoteHtml.js && node -e "import('./src/services/quoteHtml.js').then(m=>{const h=m.renderQuoteHtml({tail:'N69FP',aircraftType:'Gulfstream GIV-SP',total:232105,quoteNumber:'EXJET-1001',legs:[{from:'EHAM',to:'LGAV',depTime:1,arrTime:2,distance:1179,pax:15,fromLatLng:[52.3,4.76],toLatLng:[37.9,23.9]}],amenities:['WIFI'],acceptUrl:'https://x'},{print:true}); if(!h.includes('CHARTER QUOTE')||!h.includes('232,105')) throw new Error('render missing'); console.log('RENDER_OK len',h.length);})"
```
Expected: `RENDER_OK len <n>`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/quoteHtml.js
git commit -m "Add renderQuoteHtml — self-contained Midnight quote document"
```

---

## Task 5: `quotePdf.js` — Puppeteer PDF

**Files:** Create `backend/src/services/quotePdf.js`; modify `backend/package.json` (add puppeteer)

- [ ] **Step 1: Install Puppeteer**

Run: `cd backend && npm install puppeteer`
(Installs a bundled Chromium. **Railway:** the deploy must allow Chromium — see Task 9 rollout note.)

- [ ] **Step 2: Implement the renderer**

```js
// backend/src/services/quotePdf.js
// Renders quote HTML to a Letter PDF via headless Chromium. Waits for the Leaflet
// map (window.__mapReady) so tiles are painted before printing.
import puppeteer from 'puppeteer';

export async function renderQuotePdf(html) {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForFunction('window.__mapReady === true', { timeout: 15000 }).catch(() => {});
    return await page.pdf({ format: 'Letter', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 3: Syntax check + commit**

Run: `cd backend && node --check src/services/quotePdf.js`
```bash
git add backend/src/services/quotePdf.js backend/package.json backend/package-lock.json
git commit -m "Add quotePdf — Puppeteer Letter PDF renderer (waits for map)"
```

---

## Task 6: Quote endpoints (list / preview / pdf / send)

**Files:** Modify `backend/src/routes/quotes.js`

**Context:** Add LevelFlight-sourced endpoints. The list maps each dispatch to a summary row. Preview/pdf build the view-model, resolve airport coords, render HTML, and (for pdf) run Puppeteer. The accept URL is `https://api.levelflight.com/client/${acceptId}/accept`. Quote numbers: a simple sequence stored on a `quotes` row keyed by `dispatch_id` (reuse the existing `quotes` table; add columns `dispatch_id text`, `quote_number text` via a migration note — or store in a `quote_meta` table). For airport coords, reuse the app's airport lookup if one exists; otherwise add `backend/src/services/airports.js` with a minimal ICAO→{lat,lng} map for the fleet's common airports and fall back to null (map shows "unavailable").

> **Verify here:** confirm the accept id. Log one dispatch's `_id` and compare to a real `client/<id>/accept` URL. If they differ, find the field that matches and update `mapDispatchToQuote` (Task 2) accordingly.

- [ ] **Step 1: Add imports** at the top of `backend/src/routes/quotes.js`:

```js
import { getDispatchList } from '../services/levelflight.js';
import { mapDispatchToQuote } from '../services/quoteMap.js';
import { renderQuoteHtml } from '../services/quoteHtml.js';
import { renderQuotePdf } from '../services/quotePdf.js';
import { resolveLegCoords } from '../services/airports.js';
```

- [ ] **Step 2: Add a minimal airport coords resolver**

Create `backend/src/services/airports.js`:
```js
// Minimal ICAO -> [lat,lng] for drawing the quote route map. Extend as needed;
// unknown codes return null so the map degrades to "unavailable" gracefully.
const COORDS = {
  KFXE: [26.197, -80.171], EHAM: [52.309, 4.764], LGAV: [37.937, 23.945],
  LGKR: [39.602, 19.911], LFPG: [49.010, 2.548], TJSJ: [18.439, -66.002],
};
export function resolveLegCoords(legs) {
  return legs.map((l) => ({ ...l, fromLatLng: COORDS[l.from] || null, toLatLng: COORDS[l.to] || null }));
}
```

- [ ] **Step 3: Add the endpoints** (before `export default router;`):

```js
const ACCEPT_BASE = 'https://api.levelflight.com/client';

async function buildViewModel(dispatchId) {
  const data = await getDispatchList(1);
  const dispatch = (data?.dispatches || []).find((d) => (d?._id?.$oid || d?._id) === dispatchId);
  if (!dispatch) return null;
  const vm = mapDispatchToQuote(dispatch);
  vm.legs = resolveLegCoords(vm.legs);
  vm.acceptUrl = vm.acceptId ? `${ACCEPT_BASE}/${vm.acceptId}/accept` : null;
  vm.preparedOn = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  vm.amenities = vm.amenities || ['Flight Attendant', 'WIFI'];
  return vm;
}

// GET /api/quotes/list — all LevelFlight quotes as summary rows.
router.get('/list', async (req, res) => {
  try {
    const data = await getDispatchList(1);
    const rows = (data?.dispatches || []).map((d) => {
      const q = mapDispatchToQuote(d);
      const first = q.legs[0] || {}; const last = q.legs[q.legs.length - 1] || {};
      return { dispatchId: q.dispatchId, tail: q.tail, from: first.from, to: last.to,
        depTime: first.depTime, legs: q.legs.length, total: q.total };
    });
    res.json({ quotes: rows });
  } catch (e) { res.status(502).json({ error: e.message, quotes: [] }); }
});

// GET /api/quotes/dispatch/:id/preview — HTML for the dashboard iframe.
router.get('/dispatch/:id/preview', async (req, res) => {
  try {
    const vm = await buildViewModel(req.params.id);
    if (!vm) return res.status(404).send('Quote not found');
    res.type('html').send(renderQuoteHtml(vm, { print: req.query.print === '1' }));
  } catch (e) { res.status(500).send(`Error: ${e.message}`); }
});

// GET /api/quotes/dispatch/:id/pdf — the branded PDF.
router.get('/dispatch/:id/pdf', async (req, res) => {
  try {
    const vm = await buildViewModel(req.params.id);
    if (!vm) return res.status(404).json({ error: 'Quote not found' });
    const pdf = await renderQuotePdf(renderQuoteHtml(vm, { print: true }));
    res.type('application/pdf').set('Content-Disposition', `inline; filename="exjet-quote-${req.params.id}.pdf"`).send(pdf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```

- [ ] **Step 4: Syntax check**

Run: `cd backend && node --check src/routes/quotes.js && node --check src/services/airports.js`
Expected: no output.

- [ ] **Step 5: Manual smoke (running backend, authed)**

`curl -s "$BASE/api/quotes/list" -H "Authorization: Bearer <token>" | jq '.quotes[0]'` → a row with `dispatchId`, `total`.
Open `$BASE/api/quotes/dispatch/<id>/preview` in a browser → the Midnight quote renders.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/quotes.js backend/src/services/airports.js
git commit -m "Add quote list/preview/pdf endpoints (LevelFlight-sourced)"
```

---

## Task 7: Reuse `Quotes.jsx` as the LevelFlight quotes list + preview

**Files:** Modify `frontend/src/pages/Quotes.jsx`

**Context:** Replace the email/rate-card list with the LevelFlight quotes list from `GET /api/quotes/list`. Selecting a row shows the branded quote in an **iframe** (`/api/quotes/dispatch/:id/preview` via `apiFetch` base) with **Download PDF** and **Open Request-to-Book** actions. Keep the page's premium styling/placement.

- [ ] **Step 1: Replace the page body** with the LevelFlight list + iframe preview. Use `apiFetch` (already used app-wide) for the list; the iframe/pdf use the API base URL. Implement:

```jsx
import { useEffect, useState } from 'react';
import { apiFetch, API_BASE } from '../lib/api';

const fmtDate = (ms) => ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const money = (n) => n == null ? '—' : '$' + Number(n).toLocaleString('en-US');

export default function Quotes() {
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let on = true;
    apiFetch('/api/quotes/list').then(r => r.json()).then(j => { if (on) { setRows(j.quotes || []); setLoading(false); } }).catch(() => on && setLoading(false));
    return () => { on = false; };
  }, []);
  return (
    <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 90px)' }}>
      <div style={{ flex: '0 0 380px', overflowY: 'auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)' }}>Quotes</h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{loading ? 'Loading…' : `${rows.length} from LevelFlight`}</p>
        {rows.map((q) => (
          <div key={q.dispatchId} onClick={() => setSel(q.dispatchId)}
            style={{ padding: 12, marginTop: 8, borderRadius: 10, cursor: 'pointer',
              border: '1px solid var(--border)', background: sel === q.dispatchId ? 'rgba(79,142,247,0.12)' : 'var(--bg-card)' }}>
            <div style={{ fontWeight: 700, color: 'var(--accent)' }}>{q.from} → {q.to}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{q.tail} · {fmtDate(q.depTime)} · {q.legs} leg{q.legs === 1 ? '' : 's'}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginTop: 4 }}>{money(q.total)}</div>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {sel ? (
          <>
            <div style={{ display: 'flex', gap: 8, padding: 10, borderBottom: '1px solid var(--border)' }}>
              <a href={`${API_BASE}/api/quotes/dispatch/${sel}/pdf`} target="_blank" rel="noreferrer"
                style={{ padding: '8px 14px', background: 'var(--accent)', color: '#fff', borderRadius: 8, fontSize: 13, textDecoration: 'none' }}>Download PDF</a>
            </div>
            <iframe title="quote" src={`${API_BASE}/api/quotes/dispatch/${sel}/preview`} style={{ flex: 1, border: 0, background: '#0b1018' }} />
          </>
        ) : <div style={{ margin: 'auto', color: 'var(--text-secondary)' }}>Select a quote to preview</div>}
      </div>
    </div>
  );
}
```

> If `API_BASE` isn't already exported from `frontend/src/lib/api.js`, add `export const API_BASE = <the base URL apiFetch uses>;` there (it already composes the base internally — export the same constant). The iframe/PDF are unauthenticated GETs returning HTML/PDF; if the app requires the auth token for these, switch the iframe to fetch the HTML via `apiFetch` and inject via `srcdoc`, and the PDF to a blob download via `apiFetch`.

- [ ] **Step 2: Lint + build**

Run: `cd frontend && npx eslint src/pages/Quotes.jsx && npm run build 2>&1 | grep -E "built in|error" | head`
Expected: eslint clean (or only pre-existing unrelated warnings); build ✓.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Quotes.jsx frontend/src/lib/api.js
git commit -m "Reuse Quotes page as LevelFlight quotes list + branded preview"
```

---

## Task 8: Auth handling for preview/PDF (if required)

**Files:** Modify `backend/src/index.js` and/or `backend/src/routes/quotes.js`

**Context:** Everything under `/api` is behind `requireAuth` (`index.js`). An `<iframe src>` and an `<a href>` PDF download don't send the Bearer token, so the preview/pdf endpoints will 401. Decide one:

- [ ] **Step 1: Choose + implement**
  - **Option A (recommended):** front-end fetches the preview HTML with `apiFetch` and sets it as the iframe `srcdoc`; downloads the PDF as a blob via `apiFetch` + `URL.createObjectURL`. No backend auth change. Update Task 7's iframe to `srcdoc={html}` (state-loaded) and the button to a blob download handler.
  - **Option B:** add a short-lived signed token query param the preview/pdf accept (a tiny HMAC of dispatchId+exp), exempted from `requireAuth` like the existing OAuth callbacks. More work; only if iframes must use `src`.

Implement Option A in `Quotes.jsx` (load preview HTML into state via `apiFetch`, render `<iframe srcdoc={html}>`; PDF via `apiFetch(...).blob()` → object URL → click). Keep the endpoints unchanged.

- [ ] **Step 2: Build + manual check** — preview renders inside the dashboard; Download PDF works while logged in.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Quotes.jsx
git commit -m "Load quote preview/PDF through authenticated apiFetch (srcdoc + blob)"
```

---

## Task 9: Full verification + rollout

- [ ] **Step 1: Backend tests + syntax**

Run: `cd backend && node --test src/services/quoteMap.test.js && for f in src/services/levelflight.js src/services/quoteHtml.js src/services/quotePdf.js src/services/quoteTerms.js src/services/airports.js src/routes/quotes.js src/assets/quote/assets.js; do node --check "$f"; done`
Expected: tests pass; no syntax errors.

- [ ] **Step 2: Frontend build**

Run: `cd frontend && npm run build 2>&1 | grep -E "built in|error" | head`
Expected: build ✓.

- [ ] **Step 3: Live checks (running backend + Supabase + LevelFlight)**
  - `/api/quotes/list` returns rows with totals.
  - The Quotes page lists LevelFlight quotes; selecting one shows the Midnight preview (logo, photos, itinerary, map, total, collapsible T&C).
  - Download PDF → branded Letter PDF with the map painted and T&C on a final page.
  - "Request to Book" opens `api.levelflight.com/client/<id>/accept` and books in LevelFlight. **Confirm the id matches** (Task 6 verification).

- [ ] **Step 4: Rollout notes**
  - **Railway/Chromium:** ensure the backend image includes Chromium for Puppeteer (nixpacks: add a `puppeteer`/Chromium provider or `PUPPETEER_SKIP_DOWNLOAD=false`; or switch to `@sparticuz/chromium` + `puppeteer-core` if the platform lacks system libs). Verify a PDF generates in the deployed env, not just locally.
  - **Quote numbers / auto-draft:** deferred to a follow-up (see below) — v1 can show the dispatch-derived quote without a stored number, or generate `EXJET-<n>` at render. Confirm with the user whether persisted numbering + auto-draft is needed for launch.

---

## Deferred (confirm before building)

- **Persisted quote numbers + status + auto-draft records** (a `quotes`/`quote_meta` row per dispatch, draft created when a new dispatch appears). The spec calls for auto-draft + manual; v1 above renders on demand from live LevelFlight data. Add a Task for the `quotes` table columns (`dispatch_id`, `quote_number`, `status`) + a reconciler if the user wants persistence/numbering now.
- **Send-to-client PDF email** (`POST /api/quotes/dispatch/:id/send`): reuse `sendEmail` from `gmail.js` with the PDF buffer as an attachment. Add when the client email address source is decided (not in LevelFlight — same gap as the trip-sheet client block).
- **Trip sheet** — separate sub-project (sub-project #2).

---

## Notes for the implementer

- **Single renderer:** `renderQuoteHtml` is the one source of truth for both preview (iframe) and PDF (Puppeteer). Don't fork a second template.
- **No fabricated prices:** `total` is null when LevelFlight lacks it — render "—", never invent.
- **Accept id must be verified** against a live `client/<id>/accept` URL before relying on it (Task 6).
- **Map fidelity:** Puppeteer waits on `window.__mapReady`; if tiles are flaky in the deploy env, add a static-map fallback image in `quoteHtml` (out of scope for v1 but noted).
- **Scope:** quotes only. Trip sheets are sub-project #2.
