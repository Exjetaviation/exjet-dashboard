import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Standalone Leaflet map for ONE flight's flown path. Draws the track polyline +
// departure/arrival markers and fits bounds. Always renders the map container
// (so it initializes once and survives the track arriving asynchronously); shows
// an overlay message when there is no track. Self-contained — no Map.jsx import.
export default function FlightTrackMap({ track = [], from, to, source }) {
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
    L.polyline(track, { color: '#38bdf8', weight: 3, opacity: 0.85 }).addTo(group);
    const start = track[0], end = track[track.length - 1];
    L.circleMarker(start, { radius: 6, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1 })
      .bindTooltip(from || 'Departure', { className: 'exjet-tooltip' }).addTo(group);
    L.circleMarker(end, { radius: 6, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 })
      .bindTooltip(to || 'Arrival', { className: 'exjet-tooltip' }).addTo(group);
    group.addTo(map);
    map._trackLayer = group;
    map.fitBounds(L.latLngBounds(track), { padding: [40, 40] });
  }, [track, from, to]);

  return (
    <div style={{ position: 'relative', marginBottom: 20 }}>
      <div ref={elRef} style={{ height: 320, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }} />
      {!track.length && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 14, pointerEvents: 'none' }}>
          No flight path recorded for this flight.
        </div>
      )}
      {source === 'live' && track.length > 0 && (
        <span style={{ position: 'absolute', top: 10, right: 10, zIndex: 500, fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'rgba(56,189,248,0.15)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.4)' }}>
          live
        </span>
      )}
    </div>
  );
}
