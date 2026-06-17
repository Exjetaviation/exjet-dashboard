import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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

// Standalone Leaflet map for ONE flight's flown path. Draws the track polyline +
// departure/arrival markers and fits bounds. Always renders the map container
// (so it initializes once and survives the track arriving asynchronously); shows
// an overlay message when there is no track. Self-contained — no Map.jsx import.
export default function FlightTrackMap({ track = [], from, to, source, depLabel, arrLabel }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);

  // Create the map once.
  useEffect(() => {
    if (mapRef.current || !elRef.current) return;
    const map = L.map(elRef.current, { center: [25, -40], zoom: 3, zoomControl: true });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO', subdomains: 'abcd', maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 0); // settle size inside the layout
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Draw / redraw the track when it changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map._trackLayer) { map._trackLayer.remove(); map._trackLayer = null; }
    if (!track.length) return;
    const group = L.layerGroup();
    const lineStyle = source === 'direct'
      ? { color: '#94a3b8', weight: 2, opacity: 0.7, dashArray: '6 6' } // dashed grey = planned/approximate
      : { color: '#38bdf8', weight: 3, opacity: 0.85 };                  // solid blue = real flown track
    L.polyline(track, lineStyle).addTo(group);
    const start = track[0], end = track[track.length - 1];
    L.marker(start, { icon: pinIcon('#22c55e') })
      .bindTooltip(depLabel || from || 'Departure', { className: 'exjet-tooltip' }).addTo(group);
    L.marker(end, { icon: pinIcon('#ef4444') })
      .bindTooltip(arrLabel || to || 'Arrival', { className: 'exjet-tooltip' }).addTo(group);
    group.addTo(map);
    map._trackLayer = group;
    map.fitBounds(L.latLngBounds(track), { padding: [40, 40] });
  }, [track, from, to, source, depLabel, arrLabel]);

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

  return (
    <div style={{ position: 'relative', marginBottom: 20 }}>
      <div ref={elRef} style={{ height: 320, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }} />
      {!track.length && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 14, pointerEvents: 'none' }}>
          No flight path recorded for this flight.
        </div>
      )}
      {(source === 'live' || source === 'direct') && track.length > 0 && (
        <span style={{
          position: 'absolute', top: 10, right: 10, zIndex: 500, fontSize: 11,
          padding: '3px 8px', borderRadius: 6,
          background: source === 'direct' ? 'rgba(148,163,184,0.15)' : 'rgba(56,189,248,0.15)',
          color: source === 'direct' ? '#94a3b8' : '#38bdf8',
          border: source === 'direct' ? '1px solid rgba(148,163,184,0.4)' : '1px solid rgba(56,189,248,0.4)',
        }}>
          {source === 'direct' ? 'direct route' : 'live'}
        </span>
      )}
    </div>
  );
}
