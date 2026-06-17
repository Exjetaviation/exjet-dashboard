# Flight Map Plane + Teardrop Pins + Tooltips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the flight detail map, replace circle markers with green/red teardrop pins that show code+name+time on hover, and animate a plane icon looping the track line (facing travel direction) on every track type.

**Architecture:** All rendering in `frontend/src/components/FlightTrackMap.jsx` (module-level `pinIcon`/`planeIcon` divIcon helpers, a separate `[track]`-keyed requestAnimationFrame effect for the plane). `frontend/src/pages/FlightDetail.jsx` computes two HTML tooltip-label strings (`depLabel`/`arrLabel`) from the leg and passes them as props. Purely presentational; no backend/data changes; fleet map untouched.

**Tech Stack:** React + Vite, Leaflet.

---

## File Structure

- `frontend/src/components/FlightTrackMap.jsx` (modify) — teardrop pins, rich tooltips, looping plane animation.
- `frontend/src/pages/FlightDetail.jsx` (modify) — compute `depLabel`/`arrLabel` and pass them.

No unit tests: the geometry is a small inline interpolation and the rest is visual. Verified via eslint + `npm run build` + manual check (per the design spec).

---

## Task 1: `FlightDetail` — compute and pass tooltip labels

**Files:**
- Modify: `frontend/src/pages/FlightDetail.jsx`

**Context:** The component already has `formatDateTime(ms)` (top of file) and renders `<FlightTrackMap track={...} from={...} to={...} source={...} />`. The leg carries `leg.departure?.airport`/`leg.arrival?.airport` (ICAO), `leg._calc?.from?.name`/`leg._calc?.to?.name` (airport names), and `leg.departure?.time`/`leg.arrival?.time` (epoch ms). Leaflet tooltips render a string as HTML, so the labels may include `<strong>`/`<br>`.

- [ ] **Step 1: Build the two label strings**

In `frontend/src/pages/FlightDetail.jsx`, just after the existing `const checklist = leg.checklist?.trip || {};` line (and before the `aiFlight` object), add:

```js
  // Rich tooltip labels for the map's departure/arrival pins: code · name + time.
  const pinLabel = (code, name, verb, time) => {
    const head = name ? `<strong>${code}</strong> · ${name}` : `<strong>${code}</strong>`;
    return time ? `${head}<br>${verb} ${formatDateTime(time)}` : head;
  };
  const depLabel = pinLabel(leg.departure?.airport || 'Departure', leg._calc?.from?.name, 'Departed', leg.departure?.time);
  const arrLabel = pinLabel(leg.arrival?.airport || 'Arrival', leg._calc?.to?.name, 'Arrived', leg.arrival?.time);
```

- [ ] **Step 2: Pass the labels to the map**

Change the existing render call from:

```jsx
      <FlightTrackMap
        track={flightTrack?.track || []}
        from={leg.departure?.airport}
        to={leg.arrival?.airport}
        source={flightTrack?.source}
      />
```
to:
```jsx
      <FlightTrackMap
        track={flightTrack?.track || []}
        from={leg.departure?.airport}
        to={leg.arrival?.airport}
        source={flightTrack?.source}
        depLabel={depLabel}
        arrLabel={arrLabel}
      />
```

- [ ] **Step 3: Lint**

Run: `cd frontend && npx eslint src/pages/FlightDetail.jsx`
Expected: no NEW errors from this change (the pre-existing `set-state-in-effect` error on the ForeFlight effect and the `exhaustive-deps` warning on the `[legId]` effect may still appear — leave them, do not touch unrelated code).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/FlightDetail.jsx
git commit -m "FlightDetail: pass rich departure/arrival tooltip labels to the map"
```

---

## Task 2: `FlightTrackMap` — teardrop pins + rich tooltips

**Files:**
- Modify: `frontend/src/components/FlightTrackMap.jsx`

**Context:** The component currently draws two `L.circleMarker`s (green start `#22c55e`, red end `#ef4444`) in the `[track, from, to, source]` draw effect, with `bindTooltip(from || 'Departure', ...)` / `bindTooltip(to || 'Arrival', ...)` using the `exjet-tooltip` class. We replace the circles with teardrop-pin `divIcon`s and use the new `depLabel`/`arrLabel` props for tooltip content (falling back to `from`/`to`).

- [ ] **Step 1: Add the `depLabel`/`arrLabel` props**

Change the component signature from:

```jsx
export default function FlightTrackMap({ track = [], from, to, source }) {
```
to:
```jsx
export default function FlightTrackMap({ track = [], from, to, source, depLabel, arrLabel }) {
```

- [ ] **Step 2: Add a module-level `pinIcon` helper**

Add this near the top of the file, after the imports (module scope, outside the component):

```jsx
// Teardrop map-pin divIcon, tip anchored at the coordinate. `color` fills the pin.
function pinIcon(color) {
  return L.divIcon({
    className: 'exjet-pin',
    html: `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0C7 0 3 4 3 9c0 6.5 9 15 9 15s9-8.5 9-15c0-5-4-9-9-9z" fill="${color}" stroke="#0b1220" stroke-width="1.5"/>
      <circle cx="12" cy="9" r="3.2" fill="#0b1220"/>
    </svg>`,
    iconSize: [24, 24],
    iconAnchor: [12, 24],     // tip sits on the coordinate
    tooltipAnchor: [0, -22],  // tooltip floats above the pin
  });
}
```

- [ ] **Step 3: Replace the circle markers with pins**

In the draw effect, replace these two lines:

```jsx
    L.circleMarker(start, { radius: 6, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1 })
      .bindTooltip(from || 'Departure', { className: 'exjet-tooltip' }).addTo(group);
    L.circleMarker(end, { radius: 6, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 })
      .bindTooltip(to || 'Arrival', { className: 'exjet-tooltip' }).addTo(group);
```
with:
```jsx
    L.marker(start, { icon: pinIcon('#22c55e') })
      .bindTooltip(depLabel || from || 'Departure', { className: 'exjet-tooltip' }).addTo(group);
    L.marker(end, { icon: pinIcon('#ef4444') })
      .bindTooltip(arrLabel || to || 'Arrival', { className: 'exjet-tooltip' }).addTo(group);
```

- [ ] **Step 4: Add `depLabel`/`arrLabel` to the draw effect deps**

The draw effect dependency array is currently `[track, from, to, source]`. Change it to:

```jsx
  }, [track, from, to, source, depLabel, arrLabel]);
```

- [ ] **Step 5: Lint**

Run: `cd frontend && npx eslint src/components/FlightTrackMap.jsx`
Expected: clean (no errors).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/FlightTrackMap.jsx
git commit -m "FlightTrackMap: teardrop pins with rich departure/arrival tooltips"
```

---

## Task 3: `FlightTrackMap` — looping plane animation

**Files:**
- Modify: `frontend/src/components/FlightTrackMap.jsx`

**Context:** Add a rotating plane that loops the polyline every ~6s. It must be its own marker (added directly to the map, NOT the cleared `_trackLayer` group) and its own effect keyed `[track]`, with rAF + marker cleanup so nothing leaks or duplicates. The plane SVG points "up" (north) at rotation 0; the per-frame rotation is the bearing of the current segment.

- [ ] **Step 1: Add a module-level `planeIcon` helper**

Add at module scope (after `pinIcon`), outside the component:

```jsx
// Top-down plane divIcon. The inner `.plane-rot` element is rotated each frame to
// face the direction of travel (the SVG nose points up / north at 0deg).
function planeIcon() {
  return L.divIcon({
    className: 'exjet-plane',
    html: `<div class="plane-rot" style="width:22px;height:22px;will-change:transform;">
      <svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2 L14 10 L22 13 L22 15 L14 13 L13 20 L16 22 L16 23 L12 22 L8 23 L8 22 L11 20 L10 13 L2 15 L2 13 L10 10 Z" fill="#e2e8f0" stroke="#0b1220" stroke-width="0.8"/>
      </svg>
    </div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11], // centered on the position
  });
}
```

- [ ] **Step 2: Add the animation effect**

Add this `useEffect` AFTER the existing draw effect (inside the component, before the `return`):

```jsx
  // Animate a plane looping along the track (~6s), rotated to face travel.
  // Its own marker + effect so it never duplicates or leaks across track changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || track.length < 2) return;

    // Per-segment endpoints + cumulative planar length over the whole path.
    const segs = [];
    let total = 0;
    for (let i = 1; i < track.length; i++) {
      const a = track[i - 1], b = track[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      segs.push({ a, b, len, cum: total });
      total += len;
    }
    if (total === 0) return; // degenerate (all points identical)

    const plane = L.marker(track[0], { icon: planeIcon(), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);

    const DURATION = 6000;
    let rafId, startTs;
    const step = (ts) => {
      if (startTs === undefined) startTs = ts;
      const dist = (((ts - startTs) % DURATION) / DURATION) * total;
      let seg = segs[segs.length - 1];
      for (const s of segs) { if (dist <= s.cum + s.len) { seg = s; break; } }
      const segT = seg.len > 0 ? (dist - seg.cum) / seg.len : 0;
      const lat = seg.a[0] + (seg.b[0] - seg.a[0]) * segT;
      const lng = seg.a[1] + (seg.b[1] - seg.a[1]) * segT;
      plane.setLatLng([lat, lng]);
      const deg = Math.atan2(seg.b[1] - seg.a[1], seg.b[0] - seg.a[0]) * 180 / Math.PI; // atan2(dLng, dLat): 0=N, 90=E
      const el = plane.getElement();
      const rot = el && el.querySelector('.plane-rot');
      if (rot) rot.style.transform = `rotate(${deg}deg)`;
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      plane.remove();
    };
  }, [track]);
```

- [ ] **Step 3: Lint**

Run: `cd frontend && npx eslint src/components/FlightTrackMap.jsx`
Expected: clean (no errors).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/FlightTrackMap.jsx
git commit -m "FlightTrackMap: animated plane looping the track, facing travel"
```

---

## Task 4: Verification

- [ ] **Step 1: Lint both changed files + build**

Run: `cd frontend && npx eslint src/components/FlightTrackMap.jsx && npm run build 2>&1 | grep -E "built in|error|Error" | head`
Expected: `FlightTrackMap.jsx` lint clean; `✓ built in ...` no errors. (The build compiles `FlightDetail.jsx` too, confirming the prop wiring.)

- [ ] **Step 2: Manual check (running frontend + backend)**

- Departure/arrival markers are **teardrop pins** with tips on the coordinates — green departure, red arrival.
- Hovering a pin shows **code · name** and a **Departed/Arrived <time>** line.
- A **plane** loops the line every ~6s and **rotates** to face travel — verified on BOTH a real ADS-B track (multi-segment) and a dashed direct line (single segment).
- Changing the displayed flight (or a track arriving async) leaves exactly **one** plane (no duplicates), and leaving the page stops the animation.

---

## Notes for the implementer

- **Scope:** flight detail page map only. Do NOT touch `Map.jsx` (the fleet map).
- **No backend/data changes** — everything uses props/data the page already holds.
- **Plane marker is separate from `_trackLayer`** — it's added straight to the map and removed in its own effect cleanup, so the draw effect's `_trackLayer` clear never affects it and it never duplicates.
- **Timing uses the rAF timestamp** (`ts`) argument — no `Date`/`performance` calls needed.
- **Tooltip labels are HTML** built from internal LevelFlight data (airport codes/names) — acceptable to inject directly; no untrusted user input.
- **Don't fix pre-existing lint** in `FlightDetail.jsx` (out of scope).
