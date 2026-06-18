# Crew Trip Sheet (Flight Release) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authenticated crew View and Download-PDF the official LevelFlight Flight Release for a flight's trip, from the flight detail page.

**Architecture:** Proxy LevelFlight's authenticated `GET /api/dispatch/{id}/release` HTML (complete, Exjet-branded, self-contained inline-styled). Backend: `getDispatchRelease` in `levelflight.js` → `fetchReleaseHtml` service → authed routes `/api/tripsheet/:id` (HTML) + `/pdf` (Puppeteer). Frontend: a Trip Sheet action on `FlightDetail.jsx` (View in a modal iframe + Download PDF), both via `apiFetch` so the Bearer token is attached.

**Tech Stack:** Node/Express (ESM), axios, puppeteer-core + @sparticuz/chromium (existing), React/Vite. Tests via `node:test`.

**Verified live:** `/api/dispatch/{id}/release` returns ~67 KB HTML with all sections (Flight Release, Trip #, METAR, Currency, Maintenance, Passengers, comms, crew). The HTML is self-contained: NO external CSS/JS/images (inline `style` attributes only). The structured `review/tripSheet` JSON carries `tripId` (number) for the filename.

---

### Task 1: `getDispatchRelease` in levelflight.js

**Files:**
- Modify: `backend/src/services/levelflight.js` (add an exported function next to `getTripLog`)

- [ ] **Step 1: Add the function**

In `backend/src/services/levelflight.js`, directly after the `getTripLog` export, add:

```js
export const getDispatchRelease = async (dispatchOid) => {
  const client = await lf();
  const res = await client.get(`/api/dispatch/${dispatchOid}/release`, { responseType: 'text' });
  return res.data; // self-contained HTML string (full Flight Release / Trip Sheet)
};
```

- [ ] **Step 2: Syntax check**

Run: `cd backend && node --check src/services/levelflight.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/levelflight.js
git commit -m "feat: getDispatchRelease — fetch LevelFlight trip-sheet release HTML"
```

---

### Task 2: `fetchReleaseHtml` service (testable, status-aware)

**Files:**
- Create: `backend/src/services/tripSheet.js`
- Test: `backend/src/services/tripSheet.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/src/services/tripSheet.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchReleaseHtml } from './tripSheet.js';

test('fetchReleaseHtml returns HTML on success', async () => {
  const fakeGet = async () => '<html>Flight Release</html>';
  const html = await fetchReleaseHtml('abc', { get: fakeGet });
  assert.equal(html, '<html>Flight Release</html>');
});

test('fetchReleaseHtml returns null when the fetch throws (e.g. 404)', async () => {
  const fakeGet = async () => { const e = new Error('Request failed'); e.response = { status: 404 }; throw e; };
  const html = await fetchReleaseHtml('missing', { get: fakeGet });
  assert.equal(html, null);
});

test('fetchReleaseHtml returns null on empty body', async () => {
  const html = await fetchReleaseHtml('abc', { get: async () => '' });
  assert.equal(html, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/services/tripSheet.test.js`
Expected: FAIL — `Cannot find module './tripSheet.js'`.

- [ ] **Step 3: Implement `tripSheet.js`**

```js
// backend/src/services/tripSheet.js
// Fetches the official LevelFlight Flight Release / Trip Sheet HTML for a dispatch.
// The release is complete and self-contained (inline styles, no external assets), so
// it can be served to the dashboard and printed to PDF as-is. Returns null when the
// release is unavailable (e.g. unreleased trip / unknown id) so routes can 404.
import { getDispatchRelease } from './levelflight.js';

// `deps.get` is injected in tests; defaults to the real LevelFlight call.
export async function fetchReleaseHtml(dispatchId, deps = {}) {
  const get = deps.get || getDispatchRelease;
  try {
    const html = await get(dispatchId);
    return html && typeof html === 'string' && html.length ? html : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test src/services/tripSheet.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tripSheet.js backend/src/services/tripSheet.test.js
git commit -m "feat: fetchReleaseHtml service with status handling"
```

---

### Task 3: PDF renderer opt-out for the map-ready wait

**Files:**
- Modify: `backend/src/services/quotePdf.js`

The release HTML never sets `window.__mapReady`, so the current 15s `waitForFunction`
would stall every trip-sheet PDF. Add an option (default preserves existing behavior).

- [ ] **Step 1: Update `renderQuotePdf` signature**

In `backend/src/services/quotePdf.js`, change:

```js
export async function renderQuotePdf(html) {
```

to:

```js
export async function renderQuotePdf(html, { waitForMapReady = true } = {}) {
```

- [ ] **Step 2: Guard the wait**

Replace:

```js
    await page.waitForFunction('window.__mapReady === true', { timeout: 15000 })
      .catch(() => console.warn('[quotePdf] map not ready before print (rendering without it)'));
```

with:

```js
    if (waitForMapReady) {
      await page.waitForFunction('window.__mapReady === true', { timeout: 15000 })
        .catch(() => console.warn('[quotePdf] map not ready before print (rendering without it)'));
    }
```

- [ ] **Step 3: Syntax check + confirm existing callers unaffected**

Run: `cd backend && node --check src/services/quotePdf.js && grep -rn "renderQuotePdf(" src/routes`
Expected: syntax OK; existing callers (publicQuotes, publicItinerary) call `renderQuotePdf(html)` with one arg — still default `waitForMapReady: true`, unchanged behavior.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/quotePdf.js
git commit -m "feat: renderQuotePdf waitForMapReady opt-out for asset-only HTML"
```

---

### Task 4: Authed trip-sheet routes + mount

**Files:**
- Create: `backend/src/routes/tripSheet.js`
- Modify: `backend/src/index.js` (mount UNDER the `/api` auth guard)

- [ ] **Step 1: Create `tripSheet.js`**

```js
// backend/src/routes/tripSheet.js
// Authenticated crew Trip Sheet (Flight Release). PII-bearing, so mounted UNDER the
// /api auth guard (NOT public like /itinerary). Proxies LevelFlight's release HTML and
// prints it to PDF with the existing Puppeteer renderer.
import express from 'express';
import { fetchReleaseHtml } from '../services/tripSheet.js';
import { getTripLog } from '../services/levelflight.js';
import { renderQuotePdf } from '../services/quotePdf.js';

const router = express.Router();

// GET /api/tripsheet/:id — full release HTML for the in-dashboard modal view.
router.get('/:id', async (req, res) => {
  try {
    const html = await fetchReleaseHtml(req.params.id);
    if (!html) return res.status(404).send('Trip sheet not available for this trip yet');
    res.type('html').send(html);
  } catch (e) { res.status(502).send('Error fetching trip sheet'); }
});

// GET /api/tripsheet/:id/pdf — the release printed to PDF.
router.get('/:id/pdf', async (req, res) => {
  try {
    const html = await fetchReleaseHtml(req.params.id);
    if (!html) return res.status(404).json({ error: 'Trip sheet not available' });
    let tripId = req.params.id;
    try { const tl = await getTripLog(req.params.id); if (tl?.dispatch?.tripId != null) tripId = tl.dispatch.tripId; } catch { /* fall back to id */ }
    const pdf = await renderQuotePdf(html, { waitForMapReady: false });
    res.type('application/pdf')
      .set('Content-Disposition', `inline; filename="Trip Sheet ${tripId}.pdf"`)
      .send(pdf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
```

- [ ] **Step 2: Mount it under the auth guard in `index.js`**

Add the import next to the other route imports:

```js
import tripSheetRoutes from './routes/tripSheet.js';
```

Add the mount AFTER the `app.use('/api', ... requireAuth ...)` guard block, alongside
the other `/api/*` mounts (e.g. right after `app.use('/api/quotes', quotesRoutes);`):

```js
app.use('/api/tripsheet', tripSheetRoutes);
```

Confirm it is BELOW the auth guard (so it requires login) and that the public
`/itinerary` mount remains ABOVE the guard.

- [ ] **Step 3: Syntax check**

Run: `cd backend && node --check src/routes/tripSheet.js && node --check src/index.js`
Expected: no output.

- [ ] **Step 4: Live end-to-end check (structure-only; no PII printed)**

```bash
cd backend && node -e "
import('./src/services/levelflight.js').then(async (lf) => {
  const sl = await lf.getScheduledLegs(Date.now() - 30*864e5);
  const leg = (sl.legs||[]).find(l=>l?.pilots?.length) || sl.legs[0];
  const id = leg?.dispatch?._id?.\$oid || leg?.dispatch?._id;
  const { fetchReleaseHtml } = await import('./src/services/tripSheet.js');
  const html = await fetchReleaseHtml(id);
  const has = (s) => html.includes(s);
  console.log('htmlLen:', html.length, '| markers:', { release: has('Flight Release')||has('FLIGHT RELEASE'), trip: has('Trip #'), metar: has('METAR'), pax: has('Passengers') });
  const { renderQuotePdf } = await import('./src/services/quotePdf.js');
  const pdf = await renderQuotePdf(html, { waitForMapReady: false });
  console.log('pdf bytes:', pdf.length, '| isPDF:', pdf.slice(0,4).toString() === '%PDF');
});
"
```
Expected: nonzero `htmlLen`, markers true, `pdf bytes` in the tens-of-thousands, `isPDF: true`. (Requires `PUPPETEER_EXECUTABLE_PATH` set to a local Chrome for the PDF half on macOS; if unset, the HTML-marker half still validates the proxy.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/tripSheet.js backend/src/index.js
git commit -m "feat: authed /api/tripsheet/:id release view + pdf routes"
```

---

### Task 5: Trip Sheet action on FlightDetail (View modal + Download PDF)

**Files:**
- Modify: `frontend/src/pages/FlightDetail.jsx`

The route is authed, so View must fetch with the token (not a plain link) and render
the returned HTML in a modal iframe; Download PDF fetches a blob (same as the quote).

- [ ] **Step 1: Add state for the modal + PDF busy + error**

Inside `FlightDetail()`, next to the existing `itineraryUrl` lines, add:

```js
const [tsHtml, setTsHtml] = useState(null);     // release HTML for the modal (null = closed)
const [tsBusy, setTsBusy] = useState(false);
const [tsErr, setTsErr] = useState('');
```

- [ ] **Step 2: Add the view + download handlers**

Inside `FlightDetail()` (before the `return`), add:

```js
const viewTripSheet = async () => {
  if (!dispatchId) return;
  setTsBusy(true); setTsErr('');
  try {
    const r = await apiFetch(`/api/tripsheet/${dispatchId}`);
    if (!r.ok) { setTsErr(r.status === 404 ? 'Trip sheet not available for this trip yet.' : `Failed (HTTP ${r.status})`); return; }
    setTsHtml(await r.text());
  } catch { setTsErr('Trip sheet unavailable (network error).'); }
  finally { setTsBusy(false); }
};

const downloadTripSheetPdf = async () => {
  if (!dispatchId) return;
  setTsBusy(true); setTsErr('');
  try {
    const r = await apiFetch(`/api/tripsheet/${dispatchId}/pdf`);
    if (!r.ok) { setTsErr(r.status === 404 ? 'Trip sheet not available for this trip yet.' : `Failed (HTTP ${r.status})`); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `Trip Sheet ${leg?.dispatch?.tripId || dispatchId}.pdf`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  } catch { setTsErr('Trip sheet PDF failed (network error).'); }
  finally { setTsBusy(false); }
};
```

- [ ] **Step 3: Add the buttons to the itinerary action row**

In the `{itineraryUrl && ( ... )}` block, add a Trip Sheet button group. Replace the
closing of that flex container — change:

```jsx
              <button onClick={() => { navigator.clipboard?.writeText(itineraryUrl); setItinCopied(true); setTimeout(() => setItinCopied(false), 2000); }}
                style={{ padding: '6px 12px', background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>
                {itinCopied ? 'Copied ✓' : 'Copy link'}
              </button>
            </div>
          )}
```

to:

```jsx
              <button onClick={() => { navigator.clipboard?.writeText(itineraryUrl); setItinCopied(true); setTimeout(() => setItinCopied(false), 2000); }}
                style={{ padding: '6px 12px', background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>
                {itinCopied ? 'Copied ✓' : 'Copy link'}
              </button>
              <span style={{ width: '1px', alignSelf: 'stretch', background: 'var(--border)', margin: '0 2px' }} />
              <button onClick={viewTripSheet} disabled={tsBusy}
                style={{ padding: '6px 12px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>
                {tsBusy ? 'Loading…' : 'View trip sheet'}
              </button>
              <button onClick={downloadTripSheetPdf} disabled={tsBusy}
                style={{ padding: '6px 12px', background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>
                Trip sheet PDF
              </button>
              {tsErr && <span style={{ fontSize: '12px', color: 'var(--danger, #e5484d)' }}>{tsErr}</span>}
            </div>
          )}
```

- [ ] **Step 4: Add the modal (renders the release HTML in an iframe)**

Directly after the opening `<div>` of the component's `return` (next to where
`{aiOpen && <AgentReviewPanel .../>}` is rendered), add:

```jsx
{tsHtml !== null && (
  <div onClick={() => setTsHtml(null)}
    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', flexDirection: 'column', padding: '24px' }}>
    <div onClick={(e) => e.stopPropagation()}
      style={{ background: '#fff', borderRadius: '10px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', maxWidth: '900px', width: '100%', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #ddd', background: '#f5f5f5' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#222' }}>Trip Sheet — Trip #{leg?.dispatch?.tripId}</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={downloadTripSheetPdf} disabled={tsBusy} style={{ padding: '6px 12px', background: '#1a2436', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>Download PDF</button>
          <button onClick={() => setTsHtml(null)} style={{ padding: '6px 12px', background: '#fff', color: '#222', border: '1px solid #ccc', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>Close</button>
        </div>
      </div>
      <iframe title="trip-sheet" srcDoc={tsHtml} style={{ flex: 1, border: 0, background: '#fff' }} />
    </div>
  </div>
)}
```

- [ ] **Step 5: Build to verify the frontend compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/FlightDetail.jsx
git commit -m "feat: crew Trip Sheet view modal + PDF download on flight detail"
```

---

### Task 6: Full verification

- [ ] **Step 1: Backend tests**

Run: `cd backend && node --test`
Expected: all pass (existing + new `tripSheet` tests).

- [ ] **Step 2: Frontend build**

Run: `cd frontend && npm run build`
Expected: success.

- [ ] **Step 3: Manual check (report to user; do not automate)**

Log into the dashboard, open a flight with a released trip → **View trip sheet** shows
the full Flight Release (METARs, maintenance/currency, manifest, comms, crew) in the
modal; **Download PDF** / **Trip sheet PDF** downloads `Trip Sheet <trip#>.pdf`. Confirm
both require login (hitting `/api/tripsheet/<id>` logged out returns 401). For an
unreleased/unknown trip, the inline message reads "Trip sheet not available for this
trip yet."

---

## Self-Review

**Spec coverage:** proxy `/release` (T1 `getDispatchRelease`, T2 `fetchReleaseHtml`) ✓;
authed `/api/tripsheet/:id` HTML + `/pdf` under the guard (T4) ✓; PDF reuses Puppeteer
with the map-wait opt-out for the asset-only release HTML (T3) ✓; FlightDetail View
(token fetch → modal iframe) + Download PDF (blob), hidden without `dispatch._id` (T5)
✓; PII stays authed, no public link/copy ✓; edge cases — 404 "not available", network
failure inline message (T5), self-contained HTML needs no asset auth (T3 opt-out) ✓.

**Placeholder scan:** none — every step has complete code.

**Type/name consistency:** `getDispatchRelease(oid)` (levelflight) ← `fetchReleaseHtml(id, {get})`
(tripSheet) ← routes; `renderQuotePdf(html, { waitForMapReady })` matches T3's new
signature and existing one-arg callers stay default-true; frontend `dispatchId`
(already defined in FlightDetail from the itinerary work) reused; `leg.dispatch.tripId`
used for filenames matches the data shape used elsewhere in FlightDetail.
