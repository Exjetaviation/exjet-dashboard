// backend/src/services/docMap.js
// Shared Leaflet route + looping plane animation, embedded as inline JS in both the
// quote and itinerary documents. Reads viewModel.legs[].fromLatLng / .toLatLng.
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
