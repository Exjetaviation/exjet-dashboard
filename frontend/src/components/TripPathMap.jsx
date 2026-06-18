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

  // segments: [from, to, fromCode, toCode] for legs that have both coords
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
      <div ref={elRef} style={{ height: 240, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }} />
      {!segs.length && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 14, pointerEvents: 'none' }}>
          Route map unavailable for this trip.
        </div>
      )}
    </div>
  );
}
