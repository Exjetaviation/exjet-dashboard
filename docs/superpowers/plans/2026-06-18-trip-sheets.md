# Trip Sheets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a branded "Midnight" trip sheet for a dispatch — public web page (`/tripsheet/:id`), PDF, and a Trip Sheet action on the flight detail page — reusing the quote infrastructure.

**Architecture:** Extract the shared Leaflet map+plane script into `docMap.js`; add a `weather.js` service (Open‑Meteo) and a `tripSheetData.js` builder (`buildTripSheet` + pure mappers); render with a new `tripSheetHtml.js` (Midnight style, shared map); serve via public routes mounted outside the `/api` guard (PDF reuses `renderQuotePdf`); link from `FlightDetail.jsx`.

**Tech Stack:** Node/Express (ESM), axios, Puppeteer (existing), Leaflet (CDN), React/Vite. Tests via `node:test`.

**Data shapes (verified live):** `getTripLog(dispatchId).dispatch.legs[]` (operational trips) carry `departure/arrival.{airport,time,fbo}`, `_calc.{from,to}.{name,location:{lat,lng}}`, `_calc.distance.value`, `_calc.time` (EFT), `passengerCount`, `pilots[]` (`seat` 2=PIC / 3=SIC, `user.{firstName,lastName}`), `attendants[]` (`user`). `dispatch.{tripId,quoteId}`, `dispatch.client.company.{name,address:{street,city,postalCode,country},phones}`, `dispatch.client.customer.{firstName,lastName,_fullName}`. `tl.aircraft.{tailNumber,type.name,paxSeats}`. Open‑Meteo `daily.{time,temperature_2m_max,temperature_2m_min,weather_code}[]`.

---

### Task 1: Extract shared map+plane script into `docMap.js`

**Files:**
- Create: `backend/src/services/docMap.js`
- Modify: `backend/src/services/quoteHtml.js:24-64` (remove local `mapScript`, import it)
- Test: `backend/src/services/docMap.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/src/services/docMap.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapScript } from './docMap.js';

test('mapScript embeds segments and the plane for legs with coords', () => {
  const vm = { legs: [{ fromLatLng: [28.4, -81.3], toLatLng: [25.7, -80.3] }] };
  const s = mapScript(vm);
  assert.match(s, /const segs = \[\[\[28\.4,-81\.3\],\[25\.7,-80\.3\]\]\]/);
  assert.match(s, /qplane/);
  assert.match(s, /__mapReady/);
});

test('mapScript handles no coords (empty segs)', () => {
  const s = mapScript({ legs: [{ from: 'KFXE', to: 'KMIA' }] });
  assert.match(s, /const segs = \[\]/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/services/docMap.test.js`
Expected: FAIL — `Cannot find module './docMap.js'`.

- [ ] **Step 3: Create `docMap.js` with the script extracted verbatim from quoteHtml.js**

```js
// backend/src/services/docMap.js
// Shared Leaflet route + looping plane animation, embedded as inline JS in both the
// quote and trip-sheet documents. Reads viewModel.legs[].fromLatLng / .toLatLng.
export function mapScript(viewModel) {
  const pts = (viewModel.legs || [])
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

- [ ] **Step 4: Update `quoteHtml.js` to import the shared script**

In `backend/src/services/quoteHtml.js`, add to the imports at the top:

```js
import { mapScript } from './docMap.js';
```

Then DELETE the local `function mapScript(viewModel) { ... }` block (lines 24–64). Leave the call `<script>${mapScript(vm)}</script>` unchanged.

- [ ] **Step 5: Run tests + verify the quote still renders**

Run: `cd backend && node --test src/services/docMap.test.js && node --check src/services/quoteHtml.js && node -e "import('./src/services/quoteHtml.js').then(m=>{const h=m.renderQuoteHtml({legs:[{from:'KFXE',to:'KMIA',fromLatLng:[28.4,-81.3],toLatLng:[25.7,-80.3]}]},{});if(!h.includes('qplane'))throw new Error('no plane');console.log('quote OK')})"`
Expected: docMap tests PASS, `quote OK`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/docMap.js backend/src/services/docMap.test.js backend/src/services/quoteHtml.js
git commit -m "refactor: extract shared map+plane script into docMap"
```

---

### Task 2: Weather service (Open‑Meteo)

**Files:**
- Create: `backend/src/services/weather.js`
- Test: `backend/src/services/weather.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/src/services/weather.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weatherCodeLabel } from './weather.js';

test('weatherCodeLabel maps known WMO codes', () => {
  assert.equal(weatherCodeLabel(0), 'Clear');
  assert.equal(weatherCodeLabel(3), 'Overcast');
  assert.equal(weatherCodeLabel(61), 'Rain');
  assert.equal(weatherCodeLabel(95), 'Thunderstorm');
});

test('weatherCodeLabel falls back for unknown/null codes', () => {
  assert.equal(weatherCodeLabel(999), '—');
  assert.equal(weatherCodeLabel(null), '—');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/services/weather.test.js`
Expected: FAIL — `Cannot find module './weather.js'`.

- [ ] **Step 3: Implement `weather.js`**

```js
// backend/src/services/weather.js
// Daily forecast by airport lat/lng from Open-Meteo (free, no API key). Soft-fails to
// [] so a weather outage never breaks the trip sheet. WMO weather codes -> labels.
import axios from 'axios';

const WMO = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Violent showers',
  85: 'Snow showers', 86: 'Snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
};

export function weatherCodeLabel(code) {
  return (code != null && WMO[code]) ? WMO[code] : '—';
}

const _cache = new Map(); // key "lat,lng" -> { t, v }
const TTL = 60 * 60 * 1000;

export async function getDailyForecast(lat, lng, days = 4) {
  if (lat == null || lng == null) return [];
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}`
      + `&daily=temperature_2m_max,temperature_2m_min,weather_code`
      + `&temperature_unit=fahrenheit&forecast_days=${days}&timezone=auto`;
    const r = await axios.get(url, { timeout: 8000 });
    const d = r.data?.daily || {};
    const out = (d.time || []).map((date, i) => ({
      date,
      highF: Math.round(d.temperature_2m_max?.[i]),
      lowF: Math.round(d.temperature_2m_min?.[i]),
      condition: weatherCodeLabel(d.weather_code?.[i]),
    }));
    _cache.set(key, { t: Date.now(), v: out });
    return out;
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test src/services/weather.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/weather.js backend/src/services/weather.test.js
git commit -m "feat: Open-Meteo daily forecast service"
```

---

### Task 3: Trip-sheet data builder + pure mappers

**Files:**
- Create: `backend/src/services/tripSheetData.js`
- Test: `backend/src/services/tripSheetData.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/src/services/tripSheetData.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapTripLeg, mapClient } from './tripSheetData.js';

const leg = {
  departure: { airport: 'KFXE', time: 1000, fbo: { name: 'Banyan', address: { street: '5360 NW 20th Ter', city: 'Fort Lauderdale', state: 'FL' }, phones: ['+1 954-491-3170'] } },
  arrival: { airport: 'KMIA', time: 4000, fbo: { name: 'Signature', address: { street: '5', city: 'Miami', state: 'FL' }, phones: ['+1 305-000-0000'] } },
  passengerCount: 4,
  pilots: [
    { seat: 3, user: { firstName: 'Sam', lastName: 'Sic' } },
    { seat: 2, user: { firstName: 'Pat', lastName: 'Pic' } },
  ],
  attendants: [{ seat: 5, user: { firstName: 'Ava', lastName: 'Att' } }],
  _calc: {
    time: '0:42', distance: { value: 92 },
    from: { name: 'Fort Lauderdale Executive', location: { lat: 26.19, lng: -80.17 } },
    to: { name: 'Miami Intl', location: { lat: 25.79, lng: -80.29 } },
  },
};

test('mapTripLeg maps route, crew (PIC=seat2/SIC=seat3), fbo, coords', () => {
  const m = mapTripLeg(leg);
  assert.equal(m.from, 'KFXE');
  assert.equal(m.to, 'KMIA');
  assert.equal(m.eft, '0:42');
  assert.equal(m.distance, 92);
  assert.equal(m.pax, 4);
  assert.deepEqual(m.fromLatLng, [26.19, -80.17]);
  assert.deepEqual(m.toLatLng, [25.79, -80.29]);
  assert.equal(m.crew.pic, 'Pat Pic');
  assert.equal(m.crew.sic, 'Sam Sic');
  assert.deepEqual(m.crew.ca, ['Ava Att']);
  assert.equal(m.depFbo.name, 'Banyan');
  assert.equal(m.depFbo.address, '5360 NW 20th Ter, Fort Lauderdale, FL');
  assert.equal(m.depFbo.phone, '+1 954-491-3170');
});

test('mapTripLeg tolerates missing crew/fbo/coords', () => {
  const m = mapTripLeg({ departure: { airport: 'A' }, arrival: { airport: 'B' } });
  assert.equal(m.crew.pic, null);
  assert.deepEqual(m.crew.ca, []);
  assert.equal(m.depFbo, null);
  assert.equal(m.fromLatLng, null);
});

test('mapClient assembles name, company, address from the dispatch', () => {
  const c = mapClient({ client: {
    customer: { firstName: 'Jane', lastName: 'Doe', _fullName: 'Jane Doe' },
    company: { name: 'Concierge One', address: { street: '2735 High St', city: 'London', postalCode: 'W1', country: 'UK' }, phones: ['+44 20'] },
  } });
  assert.equal(c.name, 'Jane Doe');
  assert.equal(c.company, 'Concierge One');
  assert.equal(c.address, '2735 High St, London, W1, UK');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/services/tripSheetData.test.js`
Expected: FAIL — `Cannot find module './tripSheetData.js'`.

- [ ] **Step 3: Implement `tripSheetData.js`**

```js
// backend/src/services/tripSheetData.js
// Builds the trip-sheet view-model from getTripLog (operational dispatches carry FULL
// legs: crew, FBO, coords). Pure mappers (mapTripLeg, mapClient) are unit-tested; the
// I/O (getTripLog, weather) lives in buildTripSheet.
import { getTripLog } from './levelflight.js';
import { getDailyForecast } from './weather.js';

const fullName = (u) => (u ? [u.firstName, u.lastName].filter(Boolean).join(' ') : '') || null;
const loc = (x) => (x && x.lat != null && x.lng != null ? [x.lat, x.lng] : null);

function mapFbo(node) {
  const f = node?.fbo;
  if (!f) return null;
  const a = f.address || {};
  const address = [a.street, a.city, a.state, a.postalCode].filter(Boolean).join(', ');
  return { name: f.name || null, address: address || null, phone: f.phones?.[0] || null };
}

function mapCrew(leg) {
  const pilots = leg?.pilots || [];
  const pic = fullName(pilots.find((p) => p.seat === 2)?.user) || fullName(pilots[0]?.user);
  const sic = fullName(pilots.find((p) => p.seat === 3)?.user) || fullName(pilots[1]?.user);
  const ca = (leg?.attendants || []).map((a) => fullName(a.user)).filter(Boolean);
  return { pic: pic || null, sic: sic || null, ca };
}

export function mapTripLeg(l) {
  return {
    from: l?.departure?.airport ?? null,
    to: l?.arrival?.airport ?? null,
    fromName: l?._calc?.from?.name ?? null,
    toName: l?._calc?.to?.name ?? null,
    depTime: l?.departure?.time ?? null,
    arrTime: l?.arrival?.time ?? null,
    distance: l?._calc?.distance?.value ?? null,
    eft: l?._calc?.time ?? null,
    pax: l?.passengerCount ?? null,
    fromLatLng: loc(l?._calc?.from?.location),
    toLatLng: loc(l?._calc?.to?.location),
    depFbo: mapFbo(l?.departure),
    arrFbo: mapFbo(l?.arrival),
    crew: mapCrew(l),
  };
}

export function mapClient(dispatch) {
  const c = dispatch?.client || {};
  const cust = c.customer || {};
  const comp = c.company || {};
  const a = comp.address || {};
  const address = [a.street, a.city, a.postalCode, a.country].filter(Boolean).join(', ');
  const name = cust._fullName || [cust.firstName, cust.lastName].filter(Boolean).join(' ');
  return { name: name || null, company: comp.name || null, address: address || null };
}

export async function buildTripSheet(dispatchId) {
  const tl = await getTripLog(dispatchId);
  const dispatch = tl?.dispatch;
  if (!dispatch) return null;
  const ac = tl?.aircraft || dispatch?.aircraft || {};
  const legs = (dispatch.legs || []).map(mapTripLeg);

  // Unique airports (with coords) across all legs -> one forecast each.
  const airports = new Map();
  for (const l of legs) {
    if (l.from && l.fromLatLng) airports.set(l.from, { code: l.from, name: l.fromName, ll: l.fromLatLng });
    if (l.to && l.toLatLng) airports.set(l.to, { code: l.to, name: l.toName, ll: l.toLatLng });
  }
  const weather = [];
  for (const a of airports.values()) {
    const forecast = await getDailyForecast(a.ll[0], a.ll[1]);
    if (forecast.length) weather.push({ code: a.code, name: a.name, forecast });
  }

  return {
    dispatchId,
    tripNumber: dispatch.tripId != null ? String(dispatch.tripId) : null,
    quoteNumber: dispatch.quoteId != null ? String(dispatch.quoteId) : null,
    tail: ac?.tailNumber ?? null,
    aircraftType: ac?.type?.name ?? null,
    maxPax: ac?.paxSeats ?? null,
    client: mapClient(dispatch),
    legs,
    weather,
    preparedOn: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test src/services/tripSheetData.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tripSheetData.js backend/src/services/tripSheetData.test.js
git commit -m "feat: trip-sheet data builder and pure mappers"
```

---

### Task 4: Trip-sheet renderer (`tripSheetHtml.js`)

**Files:**
- Create: `backend/src/services/tripSheetHtml.js`
- Test: `backend/src/services/tripSheetHtml.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/src/services/tripSheetHtml.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTripSheetHtml } from './tripSheetHtml.js';

const vm = {
  dispatchId: 'abc', tripNumber: '5012', quoteNumber: '8841',
  tail: 'N69FP', aircraftType: 'Hawker 800XP', maxPax: 8,
  client: { name: 'Jane Doe', company: 'Concierge One', address: 'London, UK' },
  legs: [{
    from: 'KFXE', to: 'KMIA', fromName: 'FXE', toName: 'MIA',
    depTime: 1000, arrTime: 4000, distance: 92, eft: '0:42', pax: 4,
    fromLatLng: [26.19, -80.17], toLatLng: [25.79, -80.29],
    depFbo: { name: 'Banyan', address: 'FLL', phone: '954' },
    arrFbo: { name: 'Signature', address: 'MIA', phone: '305' },
    crew: { pic: 'Pat Pic', sic: 'Sam Sic', ca: ['Ava Att'] },
  }],
  weather: [{ code: 'KFXE', name: 'FXE', forecast: [{ date: '2026-06-18', highF: 90, lowF: 75, condition: 'Clear' }] }],
  preparedOn: 'Jun 18, 2026',
};

test('renderTripSheetHtml includes trip/quote #, crew, fbo, weather, map', () => {
  const h = renderTripSheetHtml(vm, {});
  assert.match(h, /TRIP SHEET/);
  assert.match(h, /5012/);
  assert.match(h, /8841/);
  assert.match(h, /Pat Pic/);
  assert.match(h, /Sam Sic/);
  assert.match(h, /Ava Att/);
  assert.match(h, /Banyan/);
  assert.match(h, /Clear/);
  assert.match(h, /Jane Doe/);
  assert.match(h, /qplane/); // shared map script present
  assert.match(h, /id="map"/);
});

test('renderTripSheetHtml web mode adds the Download PDF bar', () => {
  const h = renderTripSheetHtml({ ...vm, pdfUrl: '/tripsheet/abc/pdf' }, { web: true });
  assert.match(h, /Download PDF/);
  assert.match(h, /\/tripsheet\/abc\/pdf/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test src/services/tripSheetHtml.test.js`
Expected: FAIL — `Cannot find module './tripSheetHtml.js'`.

- [ ] **Step 3: Implement `tripSheetHtml.js`**

```js
// backend/src/services/tripSheetHtml.js
// Renders a trip-sheet view-model to a self-contained "Midnight" HTML document used
// for the public web page AND the Puppeteer PDF (single source of truth). Mirrors the
// quote document's styling and reuses the shared map+plane script.
import { LOGO_DATA_URI, aircraftPhotos } from '../assets/quote/assets.js';
import { mapScript } from './docMap.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDT = (ms) => (ms == null ? '' : new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
const fmtDay = (iso) => { const d = new Date(iso + 'T12:00:00'); return Number.isNaN(d.getTime()) ? esc(iso) : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };

function crewCell(label, name) {
  return name ? `<div class="cr"><span class="crl">${label}</span> <span class="crn">${esc(name)}</span></div>` : '';
}

function fboCell(label, fbo) {
  if (!fbo || !(fbo.name || fbo.address)) return '';
  return `<div class="fbo"><div class="fbol">${label}</div>
    <div class="fbon">${esc(fbo.name || '')}</div>
    ${fbo.address ? `<div class="fboa">${esc(fbo.address)}</div>` : ''}
    ${fbo.phone ? `<div class="fboa">${esc(fbo.phone)}</div>` : ''}</div>`;
}

function legBlock(leg, i) {
  const c = leg.crew || {};
  const crew = [crewCell('PIC', c.pic), crewCell('SIC', c.sic), ...(c.ca || []).map((n) => crewCell('CA', n))].filter(Boolean).join('');
  const meta = [leg.eft ? esc(leg.eft) : '', leg.distance != null ? esc(leg.distance) + ' nm' : '', leg.pax != null ? esc(leg.pax) + ' PAX' : ''].filter(Boolean).join(' · ');
  return `<div class="leg">
    <div class="leghd"><span class="legno">LEG ${i + 1}</span><span class="legmeta">${meta}</span></div>
    <div class="legroute">
      <div><div class="apt">${esc(leg.from || '')}</div><div class="aptn">${esc(leg.fromName || '')}</div><div class="aptt">${esc(fmtDT(leg.depTime))}</div></div>
      <div class="line"><span class="plane">&#9992;</span></div>
      <div style="text-align:right"><div class="apt">${esc(leg.to || '')}</div><div class="aptn">${esc(leg.toName || '')}</div><div class="aptt">${esc(fmtDT(leg.arrTime))}</div></div>
    </div>
    ${crew ? `<div class="crew">${crew}</div>` : ''}
    <div class="fbos">${fboCell('DEPARTURE FBO', leg.depFbo)}${fboCell('ARRIVAL FBO', leg.arrFbo)}</div>
  </div>`;
}

function weatherBlock(weather) {
  if (!weather || !weather.length) return '';
  const cards = weather.map((w) => `<div class="wx">
    <div class="wxa">${esc(w.code)}${w.name ? ` · ${esc(w.name)}` : ''}</div>
    <div class="wxd">${(w.forecast || []).map((f) => `<div class="wxday"><div class="wxdt">${fmtDay(f.date)}</div><div class="wxc">${esc(f.condition)}</div><div class="wxt">${esc(f.highF)}&deg; / ${esc(f.lowF)}&deg;</div></div>`).join('')}</div>
  </div>`).join('');
  return `<div class="sec">WEATHER</div><div class="wxwrap">${cards}</div>`;
}

export function renderTripSheetHtml(vm, { print = false, web = false } = {}) {
  const photos = aircraftPhotos(vm.tail);
  const photoImg = (src, alt) => (src ? `<img src="${src}" alt="${alt}" class="acimg">` : '');
  const cl = vm.client || {};
  return `<!doctype html><html><head><meta charset="utf-8">
<title>Exjet Trip Sheet${vm.tripNumber ? ' #' + esc(vm.tripNumber) : ''}</title>
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
  .prep { padding:14px 30px 4px; font-size:11px; color:#8a98ad; }
  .prep .nm { color:#fff; font-weight:600; font-size:14px; }
  .hero { display:flex; gap:18px; padding:18px 30px; align-items:center; }
  .tail { font-size:30px; font-weight:700; color:#fff; }
  .type { font-size:12px; color:#c4ced9; letter-spacing:1px; }
  .acimg { flex:1; min-width:0; height:96px; object-fit:cover; border-radius:7px; border:1px solid #233247; }
  .photos { flex:1; display:flex; gap:8px; }
  .sec { font-size:10px; letter-spacing:3px; color:#6b7890; margin:14px 30px 6px; }
  .leg { padding:13px 30px; border-bottom:1px solid #1a2638; }
  .leghd { display:flex; justify-content:space-between; align-items:baseline; }
  .legno { font-size:11px; letter-spacing:2px; color:#c4ced9; font-weight:700; }
  .legmeta { font-size:10px; color:#8a98ad; }
  .legroute { display:flex; align-items:center; gap:10px; margin:8px 0; }
  .apt { font-size:18px; font-weight:600; color:#fff; }
  .aptn { font-size:10px; color:#8a98ad; } .aptt { font-size:10px; color:#8a98ad; margin-top:2px; }
  .line { flex:1; height:1px; background:linear-gradient(90deg,#38bdf8,#2a3852); position:relative; }
  .plane { position:absolute; right:0; top:-8px; color:#38bdf8; }
  .crew { display:flex; flex-wrap:wrap; gap:8px 18px; margin:6px 0; }
  .crl { font-size:9px; letter-spacing:1px; color:#6b7890; } .crn { font-size:12px; color:#e8edf4; }
  .fbos { display:flex; gap:14px; margin-top:6px; }
  .fbo { flex:1; background:#0e1622; border:1px solid #1a2638; border-radius:7px; padding:8px 10px; }
  .fbol { font-size:9px; letter-spacing:1px; color:#6b7890; } .fbon { font-size:12px; color:#fff; font-weight:600; margin-top:2px; } .fboa { font-size:10px; color:#8a98ad; }
  #map { margin:14px 30px; height:200px; border-radius:9px; border:1px solid #233247; background:#0a0f18; }
  .nomap { display:flex; height:100%; align-items:center; justify-content:center; color:#5b6b82; font-size:12px; }
  .wxwrap { margin:0 30px; display:flex; flex-direction:column; gap:10px; }
  .wx { border:1px solid #1a2638; border-radius:8px; padding:10px 12px; background:#0e1622; }
  .wxa { font-size:12px; color:#fff; font-weight:600; margin-bottom:6px; }
  .wxd { display:flex; gap:10px; flex-wrap:wrap; }
  .wxday { flex:1; min-width:90px; text-align:center; border:1px solid #1a2638; border-radius:6px; padding:6px; }
  .wxdt { font-size:10px; color:#8a98ad; } .wxc { font-size:11px; color:#cfe0f5; margin:2px 0; } .wxt { font-size:12px; color:#fff; font-weight:600; }
  .webbar { display:flex; justify-content:flex-end; padding:10px 30px 0; }
  .webbtn { font-size:12px; padding:8px 14px; border-radius:8px; background:#1a2436; border:1px solid #8893a5; color:#e8edf4; text-decoration:none; }
  .foot { padding:18px 30px 30px; font-size:9px; color:#5b6b82; }
</style></head>
<body><div class="page">
  ${web && vm.pdfUrl ? `<div class="webbar"><a class="webbtn" href="${esc(vm.pdfUrl)}">Download PDF</a></div>` : ''}
  <div class="hdr">
    <div>${LOGO_DATA_URI ? `<img class="logo" src="${LOGO_DATA_URI}" alt="Exjet">` : '<div class="tail">EXJET</div>'}
      <div class="addr">4250 Execuair Street, Suite G · Orlando, FL 32827<br>+1 (407) 677-7792</div></div>
    <div class="qmeta"><div class="qlabel">TRIP SHEET</div>
      <div style="margin-top:10px">Trip <span style="color:#fff;font-weight:600">${esc(vm.tripNumber || '—')}</span><br>Quote ${esc(vm.quoteNumber || '—')}<br>${esc(vm.preparedOn || '')}</div></div>
  </div>
  <div class="rule"></div>
  <div class="prep">PREPARED FOR<br><span class="nm">${esc(cl.name || cl.company || '—')}</span>${cl.company && cl.name ? ` · ${esc(cl.company)}` : ''}${cl.address ? `<br>${esc(cl.address)}` : ''}</div>
  <div class="hero">
    <div style="flex:0 0 200px"><div class="tail">${esc(vm.tail || '')}</div><div class="type">${esc(vm.aircraftType || '')}</div>
      ${vm.maxPax ? `<div style="font-size:11px;color:#8a98ad;margin-top:8px">Max ${esc(vm.maxPax)} passengers</div>` : ''}</div>
    <div class="photos">${photoImg(photos.interior, 'interior')}${photoImg(photos.exterior, 'exterior')}${photoImg(photos.cabin, 'cabin')}</div>
  </div>
  <div class="sec">ITINERARY &amp; CREW</div>
  ${vm.legs.map(legBlock).join('')}
  <div id="map"></div>
  ${weatherBlock(vm.weather)}
  <div class="foot">Generated ${esc(vm.preparedOn || '')} · Exjet Aviation · Operational document.</div>
</div>
<script>${mapScript(vm)}</script>
</body></html>`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && node --test src/services/tripSheetHtml.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tripSheetHtml.js backend/src/services/tripSheetHtml.test.js
git commit -m "feat: Midnight trip-sheet HTML renderer"
```

---

### Task 5: Public trip-sheet routes + mount

**Files:**
- Create: `backend/src/routes/publicTripSheets.js`
- Modify: `backend/src/index.js` (mount the router outside `/api`, next to the `/quote` mount)

- [ ] **Step 1: Inspect the existing public-quote mount**

Run: `cd backend && grep -n "publicQuotes\|/quote\|requireAuth\|app.use" src/index.js`
Expected: shows the `import publicQuotesRoutes ...`, `app.use('/quote', publicQuotesRoutes)`, and the `/api` auth-guard line. Note the exact line where `/quote` is mounted — the trip-sheet mount goes immediately after it (both must be BEFORE the `/api` guard).

- [ ] **Step 2: Create `publicTripSheets.js`**

```js
// backend/src/routes/publicTripSheets.js
// Public, UNAUTHENTICATED trip-sheet pages. The 24-char dispatch id is the access
// token (same model as the public quote). Mounted OUTSIDE the /api auth guard.
import express from 'express';
import { buildTripSheet } from '../services/tripSheetData.js';
import { renderTripSheetHtml } from '../services/tripSheetHtml.js';
import { renderQuotePdf } from '../services/quotePdf.js';

const router = express.Router();

// GET /tripsheet/:id — interactive web trip sheet.
router.get('/:id', async (req, res) => {
  try {
    const vm = await buildTripSheet(req.params.id);
    if (!vm) return res.status(404).send('Trip sheet not found');
    vm.pdfUrl = `/tripsheet/${req.params.id}/pdf`;
    res.type('html').send(renderTripSheetHtml(vm, { print: false, web: true }));
  } catch (e) { res.status(500).send('Error generating trip sheet'); }
});

// GET /tripsheet/:id/pdf — PDF (reuses the HTML-agnostic quote PDF renderer).
router.get('/:id/pdf', async (req, res) => {
  try {
    const vm = await buildTripSheet(req.params.id);
    if (!vm) return res.status(404).json({ error: 'Trip sheet not found' });
    const pdf = await renderQuotePdf(renderTripSheetHtml(vm, { print: true }));
    res.type('application/pdf')
      .set('Content-Disposition', `inline; filename="exjet-tripsheet-${vm.tripNumber || req.params.id}.pdf"`)
      .send(pdf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
```

- [ ] **Step 3: Mount it in `index.js`**

Add the import next to the other route imports:

```js
import publicTripSheetsRoutes from './routes/publicTripSheets.js';
```

Immediately AFTER the existing `app.use('/quote', publicQuotesRoutes);` line, add:

```js
app.use('/tripsheet', publicTripSheetsRoutes);
```

(Both must remain ABOVE the `/api` `requireAuth` guard.)

- [ ] **Step 4: Verify it loads and serves a real trip sheet end-to-end**

Run: `cd backend && node --check src/routes/publicTripSheets.js && node --check src/index.js`
Expected: no output (syntax OK).

Then a live smoke test against a real operational dispatch (uses backend creds; prints only structure, NOT client values):

```bash
cd backend && node -e "
import('./src/services/levelflight.js').then(async (lf) => {
  const sl = await lf.getScheduledLegs(Date.now() - 30*864e5);
  const leg = (sl.legs||[]).find(l=>l?.pilots?.length) || sl.legs[0];
  const id = leg?.dispatch?._id?.\$oid || leg?.dispatch?._id;
  const { buildTripSheet } = await import('./src/services/tripSheetData.js');
  const { renderTripSheetHtml } = await import('./src/services/tripSheetHtml.js');
  const vm = await buildTripSheet(id);
  const h = renderTripSheetHtml(vm, { web: true, pdfUrl: '/x' });
  console.log('legs:', vm.legs.length, '| weatherAirports:', vm.weather.length,
    '| hasPIC:', vm.legs.some(l=>l.crew.pic), '| hasFBO:', vm.legs.some(l=>l.depFbo),
    '| htmlLen:', h.length, '| hasMap:', h.includes('qplane'));
});
"
```
Expected: nonzero legs, `hasPIC: true`, `hasFBO: true`, `hasMap: true` — confirming the live pipeline populates crew/FBO/weather/map. (No client PII is printed.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/publicTripSheets.js backend/src/index.js
git commit -m "feat: public /tripsheet/:id web + pdf routes"
```

---

### Task 6: Trip Sheet action on the flight detail page

**Files:**
- Modify: `frontend/src/pages/FlightDetail.jsx` (import `API_BASE`; add a Trip Sheet action row under the header)

- [ ] **Step 1: Import `API_BASE`**

In `frontend/src/pages/FlightDetail.jsx`, change the api import line:

```js
import { apiFetch, API_BASE } from '../lib/api';
```

- [ ] **Step 2: Derive the dispatch id and add copy state**

Inside `FlightDetail()`, after `const leg = state?.leg;`, add:

```js
const [tsCopied, setTsCopied] = useState(false);
const dispatchId = leg?.dispatch?._id?.$oid || leg?.dispatch?._id || null;
const tripSheetUrl = dispatchId ? `${API_BASE}/tripsheet/${dispatchId}` : null;
```

(`useState` is already imported.)

- [ ] **Step 3: Add the Trip Sheet action row**

In the header `<div style={{ flex: 1 }}>...</div>` block (the one containing the `<h1>` and the tail/Trip#/Quote# `<p>`), add this directly after that closing `</p>` (still inside `flex:1` div):

```jsx
{tripSheetUrl && (
  <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
    <a href={tripSheetUrl} target="_blank" rel="noopener noreferrer"
      style={{ padding: '6px 12px', background: 'var(--accent)', color: '#fff', borderRadius: '8px', fontSize: '12px', textDecoration: 'none' }}>
      View trip sheet ↗
    </a>
    <a href={`${tripSheetUrl}/pdf`} target="_blank" rel="noopener noreferrer"
      style={{ padding: '6px 12px', background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px', textDecoration: 'none' }}>
      Download PDF
    </a>
    <button onClick={() => { navigator.clipboard?.writeText(tripSheetUrl); setTsCopied(true); setTimeout(() => setTsCopied(false), 2000); }}
      style={{ padding: '6px 12px', background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>
      {tsCopied ? 'Copied ✓' : 'Copy link'}
    </button>
  </div>
)}
```

- [ ] **Step 4: Build to verify the frontend compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/FlightDetail.jsx
git commit -m "feat: Trip Sheet view/download/copy actions on flight detail"
```

---

### Task 7: Full verification

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && node --test`
Expected: all tests pass (existing quote/quoteMap tests + new docMap, weather, tripSheetData, tripSheetHtml tests).

- [ ] **Step 2: Frontend build**

Run: `cd frontend && npm run build`
Expected: success.

- [ ] **Step 3: Manual check (report to user; do not automate)**

Start the backend locally, open `http://localhost:3001/tripsheet/<a-real-operational-dispatch-id>` **logged out** → branded trip sheet renders with crew, FBOs, weather, and the animated route map; `…/pdf` returns a PDF. On the dashboard, open a flight → **View trip sheet** opens the public page; **Copy link** copies the URL.

---

## Self-Review

**Spec coverage:** shared map helper (T1) ✓; weather Open‑Meteo + code labels (T2) ✓; data builder + pure mappers incl. crew PIC/SIC/CA, FBO, client, trip/quote # (T3) ✓; Midnight renderer with map + web bar (T4) ✓; public web + PDF routes mounted outside `/api`, PDF reuses `renderQuotePdf` (T5) ✓; FlightDetail entry View/Download/Copy keyed by `leg.dispatch._id` (T6) ✓; tests/build (T7) ✓. Weather "Forecast unavailable" edge: `weatherBlock` omits the section when empty (graceful) — acceptable. Email link was NOT in scope for the trip sheet (spec lists View/Download/Copy only) ✓.

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `mapScript(vm)` reads `vm.legs[].fromLatLng/toLatLng` (set by `mapTripLeg`) ✓; renderer reads `leg.crew.{pic,sic,ca}`, `leg.depFbo/arrFbo.{name,address,phone}`, `vm.weather[].{code,name,forecast[].{date,highF,lowF,condition}}` — all matching `tripSheetData.js` output ✓; `renderQuotePdf(html)` is HTML-agnostic (takes a string) ✓; `vm.pdfUrl` consumed by the web bar, set by the route ✓.
