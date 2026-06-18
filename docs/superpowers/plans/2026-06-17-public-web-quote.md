# Public Web Quote + Route Plane Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the interactive quote on a public, login-free URL (`/quote/<dispatchId>`) with a working tap-to-expand T&C, a looping plane animation on the route, Request to Book, and Download PDF — plus dashboard Copy-link / Email-link actions.

**Architecture:** Extract the shared `buildViewModel` into `quoteData.js`; add a public router (`/quote/:id` + `/quote/:id/pdf`) mounted outside the `/api` auth guard; give `renderQuoteHtml` a `web` action bar and a plane animation in its map script (mirroring `FlightTrackMap`). Reuses the single HTML renderer and existing PDF pipeline.

**Tech Stack:** Node/Express (ESM), Leaflet (CDN, in-doc), Puppeteer, React + Vite.

**Reference spec:** `docs/superpowers/specs/2026-06-17-public-web-quote-design.md`.

---

## File Structure
- `backend/src/services/quoteData.js` (new) — shared `buildViewModel` + `ACCEPT_BASE`.
- `backend/src/routes/quotes.js` (modify) — import shared builder; add `send-link` endpoint.
- `backend/src/routes/publicQuotes.js` (new) — public `/quote/:id` + `/quote/:id/pdf`.
- `backend/src/index.js` (modify) — mount public router (outside `/api` guard).
- `backend/src/services/quoteHtml.js` (modify) — `web` action bar + plane animation.
- `frontend/src/pages/Quotes.jsx` (modify) — Copy-link + Email-link buttons.

---

## Task 1: Extract shared `buildViewModel` into `quoteData.js`

**Files:** Create `backend/src/services/quoteData.js`; modify `backend/src/routes/quotes.js`

**Context:** `routes/quotes.js` currently defines `ACCEPT_BASE` and `async function buildViewModel(dispatchId)` (uses `getTripLog` + `mapLegDetail`). Move both into a shared service so the public router can reuse them. `quotes.js` still needs `getDispatchList` + `mapDispatchToQuote` for `/list`.

- [ ] **Step 1: Create `backend/src/services/quoteData.js`**

```js
// Shared quote view-model builder (used by the authed dashboard routes and the
// public client routes). The per-dispatch flightLog returns FULL legs (airports,
// times, distance, EFT, inline _calc.from/to.location coords).
import { getTripLog } from './levelflight.js';
import { mapLegDetail } from './quoteMap.js';

export const ACCEPT_BASE = 'https://api.levelflight.com/client';

export async function buildViewModel(dispatchId) {
  const tl = await getTripLog(dispatchId);
  const dispatch = tl?.dispatch;
  if (!dispatch) return null;
  const ac = tl?.aircraft || dispatch?.aircraft || {};
  const internal = dispatch?._internal || {};
  return {
    dispatchId,
    quoteNumber: dispatch?.quoteId != null ? String(dispatch.quoteId) : null,
    tail: ac?.tailNumber ?? null,
    aircraftType: ac?.type?.name ?? null,
    maxPax: ac?.paxSeats ?? null,
    total: internal?.price?.breakdown?.calculatedTotal ?? internal?.price?.total ?? null,
    amenities: ['Flight Attendant', 'WIFI'],
    preparedOn: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    acceptUrl: `${ACCEPT_BASE}/${dispatchId}/accept`,
    legs: (dispatch?.legs || []).map(mapLegDetail),
  };
}
```

- [ ] **Step 2: Update `routes/quotes.js` to use it**

In `backend/src/routes/quotes.js`:
- Change the imports: remove `getTripLog` and `mapLegDetail` from their imports; keep `getDispatchList` and `mapDispatchToQuote`. Add: `import { buildViewModel } from '../services/quoteData.js';`
  - i.e. the levelflight import becomes `import { getDispatchList } from '../services/levelflight.js';`
  - and the quoteMap import becomes `import { mapDispatchToQuote } from '../services/quoteMap.js';`
- DELETE the local `const ACCEPT_BASE = ...;` line and the entire local `async function buildViewModel(dispatchId) { ... }` definition (now imported).
- Leave the `/list`, `/dispatch/:id/preview`, `/dispatch/:id/pdf` routes unchanged (they already call `buildViewModel`, now the imported one).

- [ ] **Step 3: Verify**

Run: `cd backend && node --check src/services/quoteData.js && node --check src/routes/quotes.js && node -e "import('./src/routes/quotes.js').then(()=>console.log('OK')).catch(e=>{console.error(e.message);process.exit(1)})"`
Expected: `OK` (module graph resolves; no leftover refs to the removed local `buildViewModel`/`ACCEPT_BASE`).

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/quoteData.js backend/src/routes/quotes.js
git commit -m "Extract shared buildViewModel into quoteData.js"
```

---

## Task 2: `renderQuoteHtml` — web action bar + plane animation

**Files:** Modify `backend/src/services/quoteHtml.js`

**Context:** `renderQuoteHtml(vm, { print })` builds the document. The map is drawn by `mapScript(viewModel)` (inline Leaflet). Add (a) an optional `web` action bar with a Download-PDF link (`vm.pdfUrl`), and (b) a looping plane along the route in `mapScript` (mirrors `FlightTrackMap`).

- [ ] **Step 1: Add the plane animation to `mapScript`**

Replace the existing `mapScript` function with:

```js
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
      // Looping plane along the whole route (rotates to travel direction).
      const path = []; segs.forEach((s) => { path.push(s[0], s[1]); });
      const segList = []; let total = 0;
      for (let i = 1; i < path.length; i++) { const a = path[i-1], b = path[i]; const len = Math.hypot(b[0]-a[0], b[1]-a[1]); segList.push({ a, b, len, cum: total }); total += len; }
      if (total > 0) {
        const icon = L.divIcon({ className: '', iconSize: [20,20], iconAnchor: [10,10], html: '<div class="qplane" style="width:20px;height:20px;will-change:transform"><svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2 L14 10 L22 13 L22 15 L14 13 L13 20 L16 22 L16 23 L12 22 L8 23 L8 22 L11 20 L10 13 L2 15 L2 13 L10 10 Z" fill="#e2e8f0" stroke="#0b1018" stroke-width="0.8"/></svg></div>' });
        const plane = L.marker(path[0], { icon, interactive: false, zIndexOffset: 1000 }).addTo(map);
        const DUR = 6000; let start;
        const step = (ts) => {
          if (start === undefined) start = ts;
          const dist = (((ts - start) % DUR) / DUR) * total;
          let seg = segList[segList.length - 1];
          for (const s of segList) { if (dist <= s.cum + s.len) { seg = s; break; } }
          const k = seg.len > 0 ? (dist - seg.cum) / seg.len : 0;
          plane.setLatLng([seg.a[0] + (seg.b[0]-seg.a[0])*k, seg.a[1] + (seg.b[1]-seg.a[1])*k]);
          const deg = Math.atan2(seg.b[1]-seg.a[1], seg.b[0]-seg.a[0]) * 180 / Math.PI;
          const el = plane.getElement(); const rot = el && el.querySelector('.qplane');
          if (rot) rot.style.transform = 'rotate(' + deg + 'deg)';
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }
      window.__mapReady = false;
      map.whenReady(() => setTimeout(() => { window.__mapReady = true; }, 600));
    } else { window.__mapReady = true; document.getElementById('map').innerHTML = '<div class="nomap">Route map unavailable</div>'; }
  `;
}
```

- [ ] **Step 2: Add the `web` action bar**

Change the signature `export function renderQuoteHtml(vm, { print = false } = {}) {` to:
```js
export function renderQuoteHtml(vm, { print = false, web = false } = {}) {
```

Add a CSS rule inside the `<style>` block (next to the other rules):
```css
  .webbar { display:flex; justify-content:flex-end; padding:10px 30px 0; }
  .webbtn { font-size:12px; padding:8px 14px; border-radius:8px; background:#1a2436; border:1px solid #8893a5; color:#e8edf4; text-decoration:none; }
```

Immediately after `<body><div class="page">`, insert the bar:
```js
  ${web && vm.pdfUrl ? `<div class="webbar"><a class="webbtn" href="${esc(vm.pdfUrl)}">Download PDF</a></div>` : ''}
```

- [ ] **Step 3: Verify (syntax + smoke render with web flag + plane)**

Run:
```bash
cd backend && node --check src/services/quoteHtml.js && node -e "import('./src/services/quoteHtml.js').then(m=>{const h=m.renderQuoteHtml({tail:'N69FP',total:1,quoteNumber:'1778',amenities:[],pdfUrl:'/quote/x/pdf',legs:[{from:'A',to:'B',depTime:1,distance:10,eft:'1:00',pax:2,fromLatLng:[26,-80],toLatLng:[18,-66]}]},{print:false,web:true}); if(!h.includes('webbtn')||!h.includes('qplane')||!h.includes('/quote/x/pdf')) throw new Error('missing web/plane'); console.log('OK len',h.length);})"
```
Expected: `OK len <n>`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/quoteHtml.js
git commit -m "Quote doc: web Download-PDF bar + looping route plane animation"
```

---

## Task 3: Public routes + mount

**Files:** Create `backend/src/routes/publicQuotes.js`; modify `backend/src/index.js`

- [ ] **Step 1: Create `backend/src/routes/publicQuotes.js`**

```js
// Public, UNAUTHENTICATED client quote pages. The 24-char dispatch id is the access
// token (LevelFlight's model). Mounted OUTSIDE the /api auth guard.
import express from 'express';
import { buildViewModel } from '../services/quoteData.js';
import { renderQuoteHtml } from '../services/quoteHtml.js';
import { renderQuotePdf } from '../services/quotePdf.js';

const router = express.Router();

// GET /quote/:id — interactive client web quote.
router.get('/:id', async (req, res) => {
  try {
    const vm = await buildViewModel(req.params.id);
    if (!vm) return res.status(404).send('Quote not found');
    vm.pdfUrl = `/quote/${req.params.id}/pdf`;
    res.type('html').send(renderQuoteHtml(vm, { print: false, web: true }));
  } catch (e) { res.status(500).send('Error generating quote'); }
});

// GET /quote/:id/pdf — the PDF (so the client's Download button works, no login).
router.get('/:id/pdf', async (req, res) => {
  try {
    const vm = await buildViewModel(req.params.id);
    if (!vm) return res.status(404).json({ error: 'Quote not found' });
    const pdf = await renderQuotePdf(renderQuoteHtml(vm, { print: true }));
    res.type('application/pdf').set('Content-Disposition', `inline; filename="exjet-quote-${vm.quoteNumber || req.params.id}.pdf"`).send(pdf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
```

- [ ] **Step 2: Mount it in `index.js` (outside the `/api` guard)**

Add the import near the other route imports:
```js
import publicQuotesRoutes from './routes/publicQuotes.js';
```
Add the mount alongside the other `app.use('/api/...', ...)` lines (it is NOT under `/api`, so the auth guard never applies):
```js
app.use('/quote', publicQuotesRoutes);
```

- [ ] **Step 3: Verify**

Run: `cd backend && node --check src/routes/publicQuotes.js && node --check src/index.js && node -e "import('./src/routes/publicQuotes.js').then(()=>console.log('OK'))"`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/publicQuotes.js backend/src/index.js
git commit -m "Add public /quote/:id web page + /quote/:id/pdf (unauthenticated)"
```

---

## Task 4: `send-link` endpoint (email the client link)

**Files:** Modify `backend/src/routes/quotes.js`

**Context:** `quotes.js` already imports `sendEmail` from `../services/gmail.js`. Add an authed endpoint that emails the public quote link. Build the public base URL from the request.

- [ ] **Step 1: Add the route** (before `export default router;`)

```js
// POST /api/quotes/dispatch/:id/send-link  body { to } — email the public quote link.
router.post('/dispatch/:id/send-link', async (req, res) => {
  try {
    const to = (req.body?.to || '').trim();
    if (!to) return res.status(400).json({ error: 'Recipient email required' });
    const base = `${req.protocol}://${req.get('host')}`;
    const link = `${base}/quote/${req.params.id}`;
    await sendEmail({
      to,
      subject: 'Your Exjet Charter Quote',
      body: `Thank you for considering Exjet Aviation.\n\nView your charter quote here:\n${link}\n\nYou can review the itinerary, terms, and request to book directly from that page.`,
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
```

- [ ] **Step 2: Verify**

Run: `cd backend && node --check src/routes/quotes.js && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/quotes.js
git commit -m "Add POST /api/quotes/dispatch/:id/send-link to email the public quote link"
```

---

## Task 5: Dashboard — Copy-link + Email-link buttons

**Files:** Modify `frontend/src/pages/Quotes.jsx`

**Context:** The selected-quote action bar currently has only **Download PDF**. Add **Copy client link** and **Email link**. The public link is on the backend domain — use the same base `apiFetch` targets. If `frontend/src/lib/api.js` exports a base constant, use it; otherwise add `export const API_BASE = <the base apiFetch builds>;` there and import it.

- [ ] **Step 1: Import the API base**

At the top of `Quotes.jsx`: `import { apiFetch, API_BASE } from '../lib/api';`
(If `API_BASE` is not exported by `lib/api.js`, add it there exporting the exact base URL `apiFetch` prepends to `/api/...` calls.)

- [ ] **Step 2: Add the two action handlers** (inside the component, after `downloadPdf`)

```jsx
  const copyLink = () => {
    if (!sel) return;
    navigator.clipboard?.writeText(`${API_BASE}/quote/${sel}`);
  };
  const emailLink = async () => {
    if (!sel) return;
    const to = window.prompt('Client email to send the quote link to:');
    if (!to) return;
    try {
      await apiFetch(`/api/quotes/dispatch/${sel}/send-link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to }) });
      window.alert('Quote link sent.');
    } catch { window.alert('Failed to send link.'); }
  };
```
(If `apiFetch` doesn't accept an options object, use it the way other POSTs in the app do — match the existing call signature in the codebase.)

- [ ] **Step 3: Add the buttons** next to Download PDF. Replace the action-bar `<div>` that contains the Download PDF button with:

```jsx
              <div style={{ display: 'flex', gap: 8, padding: 10, borderBottom: '1px solid var(--border)' }}>
                <button onClick={downloadPdf} disabled={pdfBusy} style={{ padding: '8px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
                  {pdfBusy ? 'Generating…' : 'Download PDF'}
                </button>
                <button onClick={copyLink} style={{ padding: '8px 14px', background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Copy client link</button>
                <button onClick={emailLink} style={{ padding: '8px 14px', background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Email link</button>
              </div>
```

- [ ] **Step 4: Lint + build**

Run: `cd frontend && npx eslint src/pages/Quotes.jsx && npm run build 2>&1 | grep -E "built in|error" | head`
Expected: eslint clean; `✓ built in …`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Quotes.jsx frontend/src/lib/api.js
git commit -m "Quotes: Copy client link + Email link actions"
```

---

## Task 6: Verification

- [ ] **Step 1: Backend syntax + tests**

Run: `cd backend && node --test src/services/quoteMap.test.js && for f in src/services/quoteData.js src/services/quoteHtml.js src/routes/quotes.js src/routes/publicQuotes.js src/index.js; do node --check "$f"; done`
Expected: tests pass; no syntax errors.

- [ ] **Step 2: Frontend build**

Run: `cd frontend && npm run build 2>&1 | grep -E "built in|error" | head`
Expected: build ✓.

- [ ] **Step 3: Live check (deployed; logged OUT for the public page)**
  - Open `https://<backend>/quote/<dispatchId>` in a private window → interactive quote renders: **plane loops the route**, **T&C taps to expand**, **Download PDF** works, **Request to Book** opens the LevelFlight accept page.
  - On the dashboard, **Copy client link** copies that URL; **Email link** prompts + sends.

---

## Notes for the implementer
- **Public by design:** `/quote/:id` and `/quote/:id/pdf` are unauthenticated (link = access). Do not put them under `/api`.
- **One renderer:** `renderQuoteHtml` serves dashboard preview, public page, and PDF — don't fork it. The plane animation runs everywhere; in the PDF, Puppeteer captures a single frame (plane near the start) — acceptable.
- **Don't break `/list`:** `quotes.js` still needs `getDispatchList` + `mapDispatchToQuote`; only `getTripLog`/`mapLegDetail`/`buildViewModel`/`ACCEPT_BASE` move to `quoteData.js`.
