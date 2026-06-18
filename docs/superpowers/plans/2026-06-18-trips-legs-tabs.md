# Trips & Legs Tabs + Dashboard Trip Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the Flights page into Legs | Trips tabs (Legs unchanged), add a grouped collapsible Trips view with Itinerary/Trip-Sheet actions, and a dashboard Trip page (`/trips/:id`) with all legs + an animated flight-path map.

**Architecture:** Pure `groupLegsIntoTrips` util groups the existing `/api/levelflight/legs` data by dispatch. `Flights.jsx` gains URL-synced tabs sharing one fetch + filter bar. New `TripsList`, `TripPathMap`, `TripDetail` components; the trip-sheet view/PDF modal is extracted from `FlightDetail` into a reusable `TripSheetActions`. No backend changes.

**Tech Stack:** React + Vite, react-router-dom (`useSearchParams`, `useNavigate`, `useLocation`, `useParams`), Leaflet (already a dep), `node:test` for the pure util.

**Reuse:** `FlightsList` (legs table, supports `hideColumns`), `FlightsFilterBar`, `FlightTrackMap` (animation approach for `TripPathMap`), `apiFetch`/`API_BASE`, existing `/itinerary/:id` (public) and `/api/tripsheet/:id` (authed) routes.

---

### Task 1: `groupLegsIntoTrips` pure util + tests

**Files:**
- Create: `frontend/src/lib/trips.js`
- Test: `frontend/src/lib/trips.test.js`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/lib/trips.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupLegsIntoTrips } from './trips.js';

const leg = (disp, dep, arr, depTime, arrTime, status = 3) => ({
  _id: { $oid: `${disp}-${depTime}` },
  departure: { airport: dep, time: depTime },
  arrival: { airport: arr, time: arrTime },
  status,
  passengerCount: 2,
  dispatch: { _id: { $oid: disp }, tripId: 25000 + Number(disp), quoteId: 9000, aircraft: { tailNumber: 'N69FP', type: { name: 'GIV' } }, client: { company: { name: 'Acme' } } },
});

test('groups legs by dispatch, orders legs, builds route + range', () => {
  const trips = groupLegsIntoTrips([
    leg('2', 'KMKC', 'KFXE', 400, 500),
    leg('1', 'KFXE', 'KMKC', 100, 200),
    leg('1', 'KMKC', 'KFXE', 300, 400),
  ]);
  assert.equal(trips.length, 2);
  const t1 = trips.find((t) => t.dispatchId === '1');
  assert.equal(t1.legCount, 2);
  assert.deepEqual(t1.legs.map((l) => l.departure.time), [100, 300]); // ordered
  assert.equal(t1.from, 'KFXE');
  assert.equal(t1.to, 'KFXE');
  assert.equal(t1.routeSummary, 'KFXE → KMKC → KFXE');
  assert.equal(t1.start, 100);
  assert.equal(t1.end, 400);
  assert.equal(t1.tail, 'N69FP');
  assert.equal(t1.client, 'Acme');
});

test('sorts trips by end desc (newest first)', () => {
  const trips = groupLegsIntoTrips([leg('1', 'A', 'B', 100, 200), leg('2', 'C', 'D', 900, 1000)]);
  assert.deepEqual(trips.map((t) => t.dispatchId), ['2', '1']);
});

test('status: Completed only when all legs completed', () => {
  const done = groupLegsIntoTrips([leg('1', 'A', 'B', 1, 2, 3), leg('1', 'B', 'A', 3, 4, 3)])[0];
  assert.equal(done.status, 3);
  const mixed = groupLegsIntoTrips([leg('1', 'A', 'B', 1, 2, 3), leg('1', 'B', 'A', 3, 4, 0)])[0];
  assert.equal(mixed.status, 0); // earliest non-completed
});

test('legs without a dispatch id go to the ungrouped bucket, not dropped', () => {
  const orphan = { _id: { $oid: 'x' }, departure: { airport: 'A', time: 5 }, arrival: { airport: 'B', time: 6 }, status: 1 };
  const trips = groupLegsIntoTrips([orphan]);
  assert.equal(trips.length, 1);
  assert.equal(trips[0].dispatchId, 'ungrouped');
  assert.equal(trips[0].legCount, 1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && node --test src/lib/trips.test.js`
Expected: FAIL — `Cannot find module './trips.js'`.

- [ ] **Step 3: Implement `trips.js`**

```js
// frontend/src/lib/trips.js
// Pure grouping of leg objects (from /api/levelflight/legs) into trips, keyed by the
// leg's dispatch id. No React / no I/O so it can be unit-tested directly.
const oid = (v) => (v && typeof v === 'object' ? v.$oid : v) || null;

export function groupLegsIntoTrips(legs = []) {
  const byTrip = new Map();
  for (const leg of legs) {
    const id = oid(leg?.dispatch?._id) || 'ungrouped';
    if (!byTrip.has(id)) byTrip.set(id, []);
    byTrip.get(id).push(leg);
  }

  const trips = [];
  for (const [dispatchId, group] of byTrip.entries()) {
    const legsSorted = [...group].sort((a, b) => (a.departure?.time || 0) - (b.departure?.time || 0));
    const d = legsSorted[0]?.dispatch || {};
    const airports = legsSorted.length
      ? [legsSorted[0].departure?.airport, ...legsSorted.map((l) => l.arrival?.airport)].filter(Boolean)
      : [];
    const allCompleted = legsSorted.every((l) => l.status === 3);
    const firstOpen = legsSorted.find((l) => l.status !== 3);
    trips.push({
      dispatchId,
      tripId: d.tripId ?? null,
      quoteId: d.quoteId ?? null,
      tail: d.aircraft?.tailNumber ?? null,
      type: d.aircraft?.type?.name ?? null,
      client: d.client?.company?.name ?? null,
      legs: legsSorted,
      legCount: legsSorted.length,
      from: airports[0] ?? null,
      to: airports[airports.length - 1] ?? null,
      routeSummary: airports.join(' → '),
      start: Math.min(...legsSorted.map((l) => l.departure?.time || Infinity)),
      end: Math.max(...legsSorted.map((l) => l.arrival?.time || l.departure?.time || 0)),
      status: allCompleted ? 3 : (firstOpen?.status ?? 0),
    });
  }
  return trips.sort((a, b) => (b.end || 0) - (a.end || 0));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && node --test src/lib/trips.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/trips.js frontend/src/lib/trips.test.js
git commit -m "feat: groupLegsIntoTrips pure util + tests"
```

---

### Task 2: Extract `TripSheetActions` from FlightDetail

**Files:**
- Create: `frontend/src/components/TripSheetActions.jsx`
- Modify: `frontend/src/pages/FlightDetail.jsx`

- [ ] **Step 1: Create `TripSheetActions.jsx`**

```jsx
// frontend/src/components/TripSheetActions.jsx
// Reusable crew Trip Sheet actions: View (authed fetch -> modal iframe) + Download PDF.
// Used by FlightDetail and the Trips views. Returns null when there's no dispatch id.
import { useState } from 'react';
import { apiFetch } from '../lib/api';

export default function TripSheetActions({ dispatchId, tripId, compact = false }) {
  const [html, setHtml] = useState(null); // modal open when non-null
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!dispatchId) return null;

  const fail = (r) => setErr(r.status === 404 ? 'Trip sheet not available for this trip yet.' : `Failed (HTTP ${r.status})`);

  const view = async () => {
    setBusy(true); setErr('');
    try {
      const r = await apiFetch(`/api/tripsheet/${dispatchId}`);
      if (!r.ok) return fail(r);
      setHtml(await r.text());
    } catch { setErr('Trip sheet unavailable (network error).'); }
    finally { setBusy(false); }
  };

  const downloadPdf = async () => {
    setBusy(true); setErr('');
    try {
      const r = await apiFetch(`/api/tripsheet/${dispatchId}/pdf`);
      if (!r.ok) return fail(r);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `Trip Sheet ${tripId || dispatchId}.pdf`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch { setErr('Trip sheet PDF failed (network error).'); }
    finally { setBusy(false); }
  };

  const pad = compact ? '5px 10px' : '6px 12px';
  return (
    <>
      <button onClick={view} disabled={busy}
        style={{ padding: pad, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>
        {busy ? 'Loading…' : 'Trip sheet'}
      </button>
      <button onClick={downloadPdf} disabled={busy}
        style={{ padding: pad, background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>
        Trip sheet PDF
      </button>
      {err && <span style={{ fontSize: '12px', color: 'var(--danger, #e5484d)' }}>{err}</span>}
      {html !== null && (
        <div onClick={() => setHtml(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', flexDirection: 'column', padding: '24px' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '10px', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', maxWidth: '900px', width: '100%', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #ddd', background: '#f5f5f5' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#222' }}>Trip Sheet{tripId ? ` — Trip #${tripId}` : ''}</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={downloadPdf} disabled={busy} style={{ padding: '6px 12px', background: '#1a2436', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>Download PDF</button>
                <button onClick={() => setHtml(null)} style={{ padding: '6px 12px', background: '#fff', color: '#222', border: '1px solid #ccc', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>Close</button>
              </div>
            </div>
            <iframe title="trip-sheet" srcDoc={html} style={{ flex: 1, border: 0, background: '#fff' }} />
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Refactor FlightDetail — remove the inline trip-sheet code**

In `frontend/src/pages/FlightDetail.jsx`:

Add the import after the existing component imports (near `import FlightTrackMap ...`):

```js
import TripSheetActions from '../components/TripSheetActions';
```

Remove the now-unused trip-sheet state (the three lines):

```js
  const [tsHtml, setTsHtml] = useState(null);     // release HTML for the modal (null = closed)
  const [tsBusy, setTsBusy] = useState(false);
  const [tsErr, setTsErr] = useState('');
```

Remove the two handlers `viewTripSheet` and `downloadTripSheetPdf` (the full
`const viewTripSheet = async () => { ... };` and `const downloadTripSheetPdf = async () => { ... };`
blocks added earlier).

Remove the trip-sheet modal block (the `{tsHtml !== null && ( ... )}` JSX added right
after `{aiOpen && <AgentReviewPanel .../>}`).

- [ ] **Step 3: Replace the trip-sheet buttons in the header with the component**

In the `{itineraryUrl && ( ... )}` action row, replace the trip-sheet portion — change:

```jsx
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

to:

```jsx
              <span style={{ width: '1px', alignSelf: 'stretch', background: 'var(--border)', margin: '0 2px' }} />
              <TripSheetActions dispatchId={dispatchId} tripId={leg?.dispatch?.tripId} />
            </div>
          )}
```

- [ ] **Step 4: Build to verify nothing broke**

Run: `cd frontend && npm run build`
Expected: build succeeds (no unused-var/JSX errors).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/TripSheetActions.jsx frontend/src/pages/FlightDetail.jsx
git commit -m "refactor: extract reusable TripSheetActions from FlightDetail"
```

---

### Task 3: `TripPathMap` — multi-leg animated map

**Files:**
- Create: `frontend/src/components/TripPathMap.jsx`

- [ ] **Step 1: Create `TripPathMap.jsx`**

```jsx
// frontend/src/components/TripPathMap.jsx
// Dashboard Leaflet map of a whole trip: one polyline per leg (airport -> airport),
// a teardrop pin at each airport, fit bounds, and a looping plane along the whole
// path. Mirrors FlightTrackMap's tiles + animation. Coords come from each leg's
// _calc.from.location / _calc.to.location.
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const loc = (x) => (x && x.lat != null && x.lng != null ? [x.lat, x.lng] : null);

function pinIcon(color) {
  return L.divIcon({
    className: 'exjet-pin',
    html: `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C7 0 3 4 3 9c0 6.5 9 15 9 15s9-8.5 9-15c0-5-4-9-9-9z" fill="${color}" stroke="#0b1220" stroke-width="1.5"/><circle cx="12" cy="9" r="3.2" fill="#0b1220"/></svg>`,
    iconSize: [24, 24], iconAnchor: [12, 24], tooltipAnchor: [0, -22],
  });
}
function planeIcon() {
  return L.divIcon({
    className: 'exjet-plane',
    html: `<div class="plane-rot" style="width:22px;height:22px;will-change:transform;"><svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2 L14 10 L22 13 L22 15 L14 13 L13 20 L16 22 L16 23 L12 22 L8 23 L8 22 L11 20 L10 13 L2 15 L2 13 L10 10 Z" fill="#e2e8f0" stroke="#0b1220" stroke-width="0.8"/></svg></div>`,
    iconSize: [22, 22], iconAnchor: [11, 11],
  });
}

export default function TripPathMap({ legs = [] }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);

  // segments: [[from,to], ...] for legs that have both coords
  const segs = legs
    .map((l) => [loc(l._calc?.from?.location), loc(l._calc?.to?.location), l.departure?.airport, l.arrival?.airport])
    .filter(([a, b]) => a && b);

  useEffect(() => {
    if (mapRef.current || !elRef.current) return;
    const map = L.map(elRef.current, { center: [25, -40], zoom: 3, zoomControl: true });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© OpenStreetMap © CARTO', subdomains: 'abcd', maxZoom: 19 }).addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 0);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Draw legs + pins, fit bounds.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map._legLayer) { map._legLayer.remove(); map._legLayer = null; }
    if (!segs.length) return;
    const group = L.layerGroup();
    const all = [];
    const seen = new Set();
    segs.forEach(([a, b, fromCode, toCode]) => {
      L.polyline([a, b], { color: '#38bdf8', weight: 2.5, opacity: 0.85 }).addTo(group);
      [[a, fromCode, '#22c55e'], [b, toCode, '#ef4444']].forEach(([p, code, color]) => {
        all.push(p);
        const key = code || `${p[0]},${p[1]}`;
        if (!seen.has(key)) { seen.add(key); L.marker(p, { icon: pinIcon(color) }).bindTooltip(code || '', { className: 'exjet-tooltip' }).addTo(group); }
      });
    });
    group.addTo(map);
    map._legLayer = group;
    map.fitBounds(L.latLngBounds(all), { padding: [40, 40] });
  }, [legs]);

  // Looping plane along the concatenated path.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !segs.length) return;
    const path = [];
    segs.forEach(([a, b]) => { path.push(a, b); });
    const list = []; let total = 0;
    for (let i = 1; i < path.length; i++) { const a = path[i - 1], b = path[i]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]); list.push({ a, b, len, cum: total }); total += len; }
    if (total === 0) return;
    const plane = L.marker(path[0], { icon: planeIcon(), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
    const DURATION = 7000; let rafId, startTs;
    const step = (ts) => {
      if (startTs === undefined) startTs = ts;
      const dist = (((ts - startTs) % DURATION) / DURATION) * total;
      let seg = list[list.length - 1];
      for (const s of list) { if (dist <= s.cum + s.len) { seg = s; break; } }
      const k = seg.len > 0 ? (dist - seg.cum) / seg.len : 0;
      plane.setLatLng([seg.a[0] + (seg.b[0] - seg.a[0]) * k, seg.a[1] + (seg.b[1] - seg.a[1]) * k]);
      const deg = Math.atan2(seg.b[1] - seg.a[1], seg.b[0] - seg.a[0]) * 180 / Math.PI;
      const rot = plane.getElement()?.querySelector('.plane-rot');
      if (rot) rot.style.transform = `rotate(${deg}deg)`;
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => { if (rafId) cancelAnimationFrame(rafId); plane.remove(); };
  }, [legs]);

  return (
    <div style={{ position: 'relative', marginBottom: 20 }}>
      <div ref={elRef} style={{ height: 340, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }} />
      {!segs.length && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 14, pointerEvents: 'none' }}>
          Route map unavailable for this trip.
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build to verify it compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/TripPathMap.jsx
git commit -m "feat: TripPathMap multi-leg animated flight-path map"
```

---

### Task 4: `TripsList` — grouped collapsible cards + actions

**Files:**
- Create: `frontend/src/components/TripsList.jsx`

- [ ] **Step 1: Create `TripsList.jsx`**

```jsx
// frontend/src/components/TripsList.jsx
// Trips view: legs grouped into collapsible trip cards with quick actions. Expanding
// shows the trip's legs via FlightsList. Itinerary opens the public page; Trip Sheet
// uses the shared TripSheetActions modal; "View trip" opens the dashboard trip page.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../lib/api';
import { groupLegsIntoTrips } from '../lib/trips';
import FlightsList from './FlightsList';
import TripSheetActions from './TripSheetActions';

const STATUS_MAP = {
  0: { label: 'Scheduled', color: '#4f8ef7' },
  1: { label: 'Active', color: '#f59e0b' },
  2: { label: 'Booked', color: '#a855f7' },
  3: { label: 'Completed', color: '#22c55e' },
};
const fmtDate = (ms) => (ms && Number.isFinite(ms) ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const range = (a, b) => (fmtDate(a) === fmtDate(b) ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`);

const HIDE = new Set(['aircraft']);

export default function TripsList({ legs = [], loading = false }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(() => new Set());
  const trips = groupLegsIntoTrips(legs);

  const toggle = (id) => setOpen((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (loading) return <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Loading trips…</div>;
  if (!trips.length) return <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>No trips match the current filter.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {trips.map((t) => {
        const s = STATUS_MAP[t.status] || { label: '—', color: '#888' };
        const expanded = open.has(t.dispatchId);
        const hasDispatch = t.dispatchId !== 'ungrouped';
        return (
          <div key={t.dispatchId} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', flexWrap: 'wrap' }}>
              <button onClick={() => toggle(t.dispatchId)} title={expanded ? 'Collapse' : 'Expand'}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▶</button>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{t.routeSummary || '—'}</span>
                  {t.tripId && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Trip #{t.tripId}</span>}
                  <span style={{ background: `${s.color}22`, color: s.color, border: `1px solid ${s.color}44`, borderRadius: 20, padding: '2px 9px', fontSize: 11 }}>{s.label}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
                  {range(t.start, t.end)} · {t.tail || '—'} · {t.legCount} leg{t.legCount === 1 ? '' : 's'}{t.client ? ` · ${t.client}` : ''}
                </div>
              </div>
              {hasDispatch && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button onClick={() => navigate(`/trips/${t.dispatchId}`, { state: { trip: t } })}
                    style={{ padding: '5px 10px', background: 'var(--bg-secondary, #11161f)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, cursor: 'pointer' }}>View trip ↗</button>
                  <a href={`${API_BASE}/itinerary/${t.dispatchId}`} target="_blank" rel="noopener noreferrer"
                    style={{ padding: '5px 10px', background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, textDecoration: 'none' }}>Itinerary</a>
                  <TripSheetActions dispatchId={t.dispatchId} tripId={t.tripId} compact />
                </div>
              )}
            </div>
            {expanded && (
              <div style={{ borderTop: '1px solid var(--border)' }}>
                <FlightsList legs={t.legs} hideColumns={HIDE} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Build to verify it compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/TripsList.jsx
git commit -m "feat: TripsList grouped collapsible trip cards with actions"
```

---

### Task 5: `Flights.jsx` — Legs | Trips tabs

**Files:**
- Modify: `frontend/src/pages/Flights.jsx`

- [ ] **Step 1: Replace the file body with the tabbed container**

```jsx
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import FlightsFilterBar from '../components/FlightsFilterBar';
import FlightsList from '../components/FlightsList';
import TripsList from '../components/TripsList';

export default function Flights() {
  const { data, loading, error } = useApi('/api/levelflight/legs');
  const legs = data?.legs || [];
  const [visible, setVisible] = useState([]);
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'trips' ? 'trips' : 'legs';
  const setView = (v) => setParams((p) => { const n = new URLSearchParams(p); v === 'trips' ? n.set('view', 'trips') : n.delete('view'); return n; }, { replace: true });

  const Tab = ({ id, label }) => (
    <button onClick={() => setView(id)}
      style={{ padding: '8px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'none', border: 'none',
        color: view === id ? 'var(--accent)' : 'var(--text-secondary)',
        borderBottom: view === id ? '2px solid var(--accent)' : '2px solid transparent' }}>
      {label}
    </button>
  );

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: '600', color: 'var(--text-primary)' }}>Flights</h1>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          {loading ? 'Loading...' : `${legs.length} legs · ${visible.length} shown`}
        </p>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        <Tab id="legs" label="Legs" />
        <Tab id="trips" label="Trips" />
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '12px 16px', color: 'var(--danger)', marginBottom: '16px' }}>
          Error loading flights: {error}
        </div>
      )}

      <FlightsFilterBar legs={legs} onChange={setVisible} />
      {view === 'trips'
        ? <TripsList legs={visible} loading={loading} />
        : <FlightsList legs={visible} loading={loading} />}
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Flights.jsx
git commit -m "feat: Legs | Trips tabs on the Flights page (URL-synced)"
```

---

### Task 6: `TripDetail` page + route

**Files:**
- Create: `frontend/src/pages/TripDetail.jsx`
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Create `TripDetail.jsx`**

```jsx
// frontend/src/pages/TripDetail.jsx
// Dashboard trip page: header + multi-leg flight-path map + legs list + actions.
// Receives the trip via router state; on a cold load it refetches legs and regroups.
import { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { apiFetch, API_BASE } from '../lib/api';
import { groupLegsIntoTrips } from '../lib/trips';
import FlightsList from '../components/FlightsList';
import TripPathMap from '../components/TripPathMap';
import TripSheetActions from '../components/TripSheetActions';

const STATUS_MAP = { 0: { label: 'Scheduled', color: '#4f8ef7' }, 1: { label: 'Active', color: '#f59e0b' }, 2: { label: 'Booked', color: '#a855f7' }, 3: { label: 'Completed', color: '#22c55e' } };
const fmtDate = (ms) => (ms && Number.isFinite(ms) ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const range = (a, b) => (fmtDate(a) === fmtDate(b) ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`);
const HIDE = new Set(['aircraft']);

export default function TripDetail() {
  const { id } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const [trip, setTrip] = useState(state?.trip && state.trip.dispatchId === id ? state.trip : null);
  const [loading, setLoading] = useState(!trip);

  useEffect(() => {
    if (trip) return;
    let on = true;
    (async () => {
      try {
        const r = await apiFetch('/api/levelflight/legs');
        const j = await r.json();
        const found = groupLegsIntoTrips(j.legs || []).find((t) => t.dispatchId === id);
        if (on) { setTrip(found || null); setLoading(false); }
      } catch { if (on) setLoading(false); }
    })();
    return () => { on = false; };
  }, [id, trip]);

  if (loading) return <div style={{ padding: 40, color: 'var(--text-secondary)' }}>Loading trip…</div>;
  if (!trip) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
      <p>Trip not found.</p>
      <button onClick={() => navigate('/flights?view=trips')} style={{ marginTop: 16, padding: '8px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Back to Trips</button>
    </div>
  );

  const s = STATUS_MAP[trip.status] || { label: '—', color: '#888' };
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/flights?view=trips')} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}>← Trips</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-primary)' }}>{trip.routeSummary || 'Trip'}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            {trip.tripId ? `Trip #${trip.tripId} · ` : ''}{range(trip.start, trip.end)} · {trip.tail || '—'} · {trip.legCount} leg{trip.legCount === 1 ? '' : 's'}{trip.client ? ` · ${trip.client}` : ''}
            <span style={{ marginLeft: 10, background: `${s.color}22`, color: s.color, border: `1px solid ${s.color}44`, borderRadius: 20, padding: '2px 9px', fontSize: 11 }}>{s.label}</span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <a href={`${API_BASE}/itinerary/${trip.dispatchId}`} target="_blank" rel="noopener noreferrer"
            style={{ padding: '6px 12px', background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, textDecoration: 'none' }}>Itinerary ↗</a>
          <TripSheetActions dispatchId={trip.dispatchId} tripId={trip.tripId} />
        </div>
      </div>

      <TripPathMap legs={trip.legs} />
      <FlightsList legs={trip.legs} hideColumns={HIDE} />
    </div>
  );
}
```

- [ ] **Step 2: Add the route in `App.jsx`**

Add the import with the other page imports:

```js
import TripDetail from './pages/TripDetail';
```

Add the route just after the `/flights/:id` route:

```jsx
          <Route path="/trips/:id" element={<TripDetail />} />
```

- [ ] **Step 3: Build**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/TripDetail.jsx frontend/src/App.jsx
git commit -m "feat: dashboard Trip detail page (/trips/:id) with flight-path map"
```

---

### Task 7: Full verification

- [ ] **Step 1: Pure util tests**

Run: `cd frontend && node --test src/lib/trips.test.js`
Expected: PASS.

- [ ] **Step 2: Build**

Run: `cd frontend && npm run build`
Expected: success, no warnings about unresolved imports.

- [ ] **Step 3: Manual check (report to user; do not automate)**

Open Flights → **Legs** shows today's table; **Trips** shows grouped cards; the
`?view=trips` URL persists on refresh. Apply a date filter → both tabs reflect it.
Expand a trip → its legs show; a leg row → `/flights/:id`. **Itinerary** opens the
public page in a new tab; **Trip sheet** opens the modal + Download PDF. **View trip**
→ `/trips/:id` shows the header, the animated multi-leg map, and the legs list; the
Back button returns to Trips; refreshing `/trips/:id` still loads (refetch path).

---

## Self-Review

**Spec coverage:** Legs|Trips tabs + URL sync + shared fetch/filter (T5) ✓; pure grouping (T1) ✓; collapsible trip cards with Itinerary (public) + Trip Sheet (modal) + View trip (T4) ✓; shared `TripSheetActions` extracted from FlightDetail and reused (T2) ✓; multi-leg animated `TripPathMap` (T3) ✓; `/trips/:id` dashboard page with map + legs + actions, deep-link refetch (T6) ✓; tests/build (T7) ✓. Edge cases — ungrouped bucket (T1), no-coords map message (T3), trip-not-found (T6) ✓.

**Placeholder scan:** none — every step has complete code.

**Type/name consistency:** `groupLegsIntoTrips` returns `{ dispatchId, tripId, tail, type, client, legs, legCount, from, to, routeSummary, start, end, status }` — consumed identically by `TripsList`, `TripDetail` (range/status/legs) ✓; `TripSheetActions({ dispatchId, tripId, compact })` called with those props in FlightDetail/TripsList/TripDetail ✓; `FlightsList` reused with `legs` + `hideColumns` (existing prop) ✓; `TripPathMap({ legs })` reads `_calc.from/to.location` (the shape FlightDetail already uses) ✓; navigation `state: { trip }` matches `TripDetail`'s `state?.trip` guard keyed on `dispatchId === id` ✓.
