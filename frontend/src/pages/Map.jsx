import { useApi } from '../hooks/useApi';
import { useAdsb, fetchPreviousFlights } from '../hooks/useAdsb';
import { useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import FlyingTimer from '../components/FlyingTimer';

const STATUS = {
  0: { color: '#4f8ef7', label: 'Scheduled' },
  1: { color: '#f59e0b', label: 'Active' },
  2: { color: '#a855f7', label: 'Booked' },
  3: { color: '#22c55e', label: 'Completed' },
};

const getAircraftPositions = (legs) => {
  const acMap = {};
  const now = Date.now();

  legs.forEach(leg => {
    const tail = leg.dispatch?.aircraft?.tailNumber;
    if (!tail) return;

    if (!acMap[tail]) {
      acMap[tail] = {
        tail,
        type: leg.dispatch?.aircraft?.type?.name,
        legs: [],
      };
    }
    acMap[tail].legs.push(leg);
  });

  return Object.values(acMap).map(ac => {
    const sorted = [...ac.legs].sort((a, b) => (b.departure?.time || 0) - (a.departure?.time || 0));

    const activeLeg = sorted.find(l => l.departure?.time <= now && l.arrival?.time >= now);
    const lastDeparted = sorted.find(l => l.departure?.time <= now);
    const nextFlight = [...sorted].reverse().find(l => l.departure?.time > now);

    let position = null;
    let airport = null;
    let statusLabel = 'On Ground';
    let statusColor = '#22c55e';
    let isFlying = false;
    let currentLeg = null;

    if (activeLeg) {
      const depLoc = activeLeg._calc?.from?.location;
      const arrLoc = activeLeg._calc?.to?.location;
      if (depLoc && arrLoc) {
        const elapsed = now - activeLeg.departure.time;
        const total = activeLeg.arrival.time - activeLeg.departure.time;
        const frac = Math.min(Math.max(elapsed / total, 0), 1);
        position = {
          lat: depLoc.lat + (arrLoc.lat - depLoc.lat) * frac,
          lng: depLoc.lng + (arrLoc.lng - depLoc.lng) * frac,
        };
        airport = `${activeLeg.departure.airport} → ${activeLeg.arrival.airport}`;
        statusLabel = 'In Flight';
        statusColor = '#f59e0b';
        isFlying = true;
        currentLeg = activeLeg;
      }
    } else if (lastDeparted) {
  const arrLoc = lastDeparted._calc?.to?.location;
  if (arrLoc && lastDeparted.arrival?.time < now) {
    position = { lat: arrLoc.lat, lng: arrLoc.lng };
    airport = lastDeparted.arrival?.airport;
    statusLabel = 'On Ground';
    statusColor = '#22c55e';
    currentLeg = lastDeparted;
  } else if (lastDeparted._calc?.from?.location) {
    position = { lat: lastDeparted._calc.from.location.lat, lng: lastDeparted._calc.from.location.lng };
    airport = lastDeparted.departure?.airport;
    statusLabel = 'On Ground';
    statusColor = '#22c55e';
    currentLeg = lastDeparted;
  }
}
    return {
      ...ac,
      position,
      airport,
      statusLabel,
      statusColor,
      isFlying,
      currentLeg,
      activeLeg: activeLeg || null,
      nextFlight,
    };
  }).filter(ac => ac.position);
};

const createAircraftIcon = (color, isFlying, heading = 0) => {
  const size = isFlying ? 34 : 26;
  const rot = Number.isFinite(heading) ? heading : 0;
  const html = `
    <div style="width:${size}px;height:${size}px;transform:rotate(${rot}deg);
      transform-origin:center center;display:flex;align-items:center;
      justify-content:center;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35));">
      <svg viewBox="0 0 24 24" width="${size}" height="${size}" style="display:block">
        <path d="M12 2c-.5 0-1 .5-1 1.5V9L3 14v2l8-2.5V19l-2 1.5V22l3-1 3 1v-1.5L13 19v-5.5l8 2.5v-2l-8-5V3.5C13 2.5 12.5 2 12 2z"
              fill="${color}" stroke="white" stroke-width="0.6"/>
      </svg>
    </div>`;
  return L.divIcon({
    className: 'aircraft-icon',
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

const destinationIcon = L.divIcon({
  className: 'aircraft-dest-icon',
  html: `
    <div style="width:16px;height:16px;display:flex;align-items:center;justify-content:center;
      filter:drop-shadow(0 1px 2px rgba(0,0,0,.4));">
      <svg viewBox="0 0 24 24" width="16" height="16" style="display:block">
        <circle cx="12" cy="12" r="6" fill="none" stroke="#94a3b8" stroke-width="2.5"/>
        <circle cx="12" cy="12" r="1.5" fill="#94a3b8"/>
      </svg>
    </div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

// Sample a great-circle path (slerp) between two {lat,lng} airports into N points —
// the planned route for an upcoming flight (before a real ADS-B track exists).
const gcPath = (a, b, n = 48) => {
  const toR = (d) => (d * Math.PI) / 180, toD = (r) => (r * 180) / Math.PI;
  const lat1 = toR(a.lat), lon1 = toR(a.lng), lat2 = toR(b.lat), lon2 = toR(b.lng);
  const dLat = lat2 - lat1, dLon = lon2 - lon1;
  const hav = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const dsig = 2 * Math.asin(Math.min(1, Math.sqrt(hav)));
  if (!(dsig > 0)) return [[a.lat, a.lng], [b.lat, b.lng]];
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const f = k / n;
    const A = Math.sin((1 - f) * dsig) / Math.sin(dsig), B = Math.sin(f * dsig) / Math.sin(dsig);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    pts.push([toD(Math.atan2(z, Math.sqrt(x * x + y * y))), toD(Math.atan2(y, x))]);
  }
  return pts;
};

// Initial bearing (degrees) from a [lat,lng] to b, for orienting the replay icon.
const bearing = (a, b) => {
  const toR = (d) => (d * Math.PI) / 180;
  const toD = (r) => (r * 180) / Math.PI;
  const dLng = toR(b[1] - a[1]);
  const y = Math.sin(dLng) * Math.cos(toR(b[0]));
  const x = Math.cos(toR(a[0])) * Math.sin(toR(b[0])) - Math.sin(toR(a[0])) * Math.cos(toR(b[0])) * Math.cos(dLng);
  return (toD(Math.atan2(y, x)) + 360) % 360;
};

export default function Map() {
  const { data, loading } = useApi('/api/levelflight/legs');
  const [showTrail, setShowTrail] = useState(false);
  const { positions: live, trails, updatedAt } = useAdsb(20000, showTrail);
  const navigate = useNavigate();
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const trailLayerRef = useRef(null);
  const overlayLayerRef = useRef(null);   // destination icons + dashed dest lines, redrawn each update
  const prevLayerRef = useRef(null);      // replay layer: faint full track + growing trail + ghost plane
  const replayRafRef = useRef(null);      // requestAnimationFrame id for the replay loop
  const didFitRef = useRef(false);
  const mapWrapRef = useRef(null);
  const [cssFs, setCssFs] = useState(false);      // CSS-maximize fallback when the Fullscreen API is unavailable
  const [nativeFs, setNativeFs] = useState(false);
  const [selected, setSelected] = useState(null);
  const [selectedTail, setSelectedTail] = useState(null);
  const [prevDays, setPrevDays] = useState(30);
  const [prevFlights, setPrevFlights] = useState([]);
  const [replayFlight, setReplayFlight] = useState(null); // the previous flight being replayed
  const [replayNonce, setReplayNonce] = useState(0);      // bump to (re)start the replay
  const [replayPct, setReplayPct] = useState(0);
  const [replayDone, setReplayDone] = useState(false);

  const legs = data?.legs || [];
  const scheduled = getAircraftPositions(legs);

  // Live ADS-B wins; aircraft with no live position keep their scheduled-leg
  // position (parked / transponder off), so they still show at last airport.
  const aircraft = scheduled.map(ac => {
    // Prefer the live ADS-B fix; fall back to the scheduled-leg position.
    const livePos = live[ac.tail];
    const hasLive = !!(livePos && livePos.lat != null && livePos.lon != null);
    const markerLat = hasLive ? livePos.lat : ac.position.lat;
    const markerLng = hasLive ? livePos.lon : ac.position.lng;
    const heading = (hasLive ? livePos.track : undefined) ?? 0;
    const isAirborne = hasLive ? !livePos.onGround : (ac.statusLabel === 'In Flight');
    if (hasLive) {
      return {
        ...ac,
        position: { lat: markerLat, lng: markerLng },
        heading,
        isFlying: isAirborne,
        statusLabel: livePos.onGround ? 'On Ground · live' : 'In Flight · live',
        statusColor: livePos.onGround ? '#22c55e' : '#f59e0b',
        track: livePos.track,
        live: livePos,
        source: 'adsb',
      };
    }
    return { ...ac, position: { lat: markerLat, lng: markerLng }, heading, isFlying: isAirborne, source: 'scheduled' };
  });
  const liveCount = aircraft.filter(ac => ac.source === 'adsb').length;

  // Keep the open detail card in sync with the latest live data instead of the
  // snapshot captured at click time.
  const selectedAc = selected ? (aircraft.find(ac => ac.tail === selected.tail) || selected) : null;

  useEffect(() => {
    if (mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [25, -40],
      zoom: 4,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    mapInstanceRef.current = map;
    trailLayerRef.current = L.layerGroup().addTo(map);
    overlayLayerRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      trailLayerRef.current = null;
      overlayLayerRef.current = null;
      prevLayerRef.current = null;
    };
  }, []);

  // Full screen: prefer the native Fullscreen API, fall back to CSS-maximize
  // (covers older browsers that lack the API). Either way Leaflet needs an
  // invalidateSize once the container has resized.
  const isFs = nativeFs || cssFs;
  const enterFs = () => {
    const el = mapWrapRef.current;
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => setCssFs(true));
    else setCssFs(true);
  };
  const exitFs = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    setCssFs(false);
  };
  const toggleFs = () => (isFs ? exitFs() : enterFs());

  useEffect(() => {
    const onFs = () => {
      setNativeFs(!!document.fullscreenElement);
      setTimeout(() => mapInstanceRef.current?.invalidateSize(), 60);
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    setTimeout(() => mapInstanceRef.current?.invalidateSize(), 60);
    if (!cssFs) return;
    const onKey = e => { if (e.key === 'Escape') setCssFs(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cssFs]);

  // Redraw the ADS-B flight trails when the data, toggle, or fleet changes.
  useEffect(() => {
    const layer = trailLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!showTrail) return;
    Object.entries(trails || {}).forEach(([tail, pts]) => {
      if (!pts || pts.length < 2) return;
      const ac = aircraft.find(a => a.tail === tail);
      const color = ac?.statusColor || '#4f8ef7';
      L.polyline(pts, { color, weight: 2.5, opacity: 0.65 }).addTo(layer);
    });
  }, [trails, showTrail, aircraft]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || aircraft.length === 0) return;

    Object.values(markersRef.current).forEach(m => m.remove());
    markersRef.current = {};

    // Redraw destination icons + dashed dest lines into a layer group so they
    // don't accumulate across live polls.
    const overlay = overlayLayerRef.current;
    overlay?.clearLayers();

    aircraft.forEach(ac => {
      const icon = createAircraftIcon(ac.statusColor, ac.isFlying, ac.heading);
      const marker = L.marker([ac.position.lat, ac.position.lng], { icon })
        .addTo(map)
        .on('click', () => {
          setSelected(ac);
          setSelectedTail(ac.tail);
        });

      // For airborne aircraft, draw the destination airport + a faint dashed
      // line from the aircraft to it.
      const destLoc = ac.activeLeg?._calc?.to?.location;
      if (overlay && ac.isFlying && destLoc && destLoc.lat != null && destLoc.lng != null) {
        L.polyline(
          [[ac.position.lat, ac.position.lng], [destLoc.lat, destLoc.lng]],
          { color: '#94a3b8', weight: 1.5, opacity: 0.5, dashArray: '4 6' },
        ).addTo(overlay);
        L.marker([destLoc.lat, destLoc.lng], { icon: destinationIcon, interactive: false }).addTo(overlay);
      }

      // For parked aircraft, label the airport so the icon clearly reads as "on the
      // ground at <ICAO>" rather than floating.
      if (overlay && !ac.isFlying && ac.airport) {
        L.marker([ac.position.lat, ac.position.lng], { icon: L.divIcon({ className: '', iconSize: [0, 0] }), interactive: false })
          .addTo(overlay)
          .bindTooltip(ac.airport, { permanent: true, direction: 'top', offset: [0, -12], className: 'exjet-tooltip' });
      }

      const liveLine = ac.live
        ? `<br/>${ac.live.altitudeFt != null ? `${ac.live.altitudeFt.toLocaleString()} ft` : '—'} · ${ac.live.groundSpeedKt != null ? `${Math.round(ac.live.groundSpeedKt)} kt` : '—'}${ac.live.callsign ? ` · ${ac.live.callsign}` : ''}`
        : '';
      const srcLine = `<br/><span style="opacity:0.6">${ac.source === 'adsb' ? 'Live (ADS-B)' : 'Scheduled'}</span>`;
      marker.bindTooltip(`<strong>${ac.tail}</strong><br/>${ac.statusLabel} · ${ac.airport || ''}${liveLine}${srcLine}`, {
        permanent: false,
        className: 'exjet-tooltip',
        offset: [0, -10],
      });

      markersRef.current[ac.tail] = marker;
    });

    // Fit bounds once on first draw only — re-fitting on every live poll would
    // fight the user's pan/zoom every 20s.
    if (!didFitRef.current && aircraft.length > 0) {
      const bounds = L.latLngBounds(aircraft.map(ac => [ac.position.lat, ac.position.lng]));
      map.fitBounds(bounds, { padding: [80, 80], maxZoom: 8 });
      didFitRef.current = true;
    }
  }, [aircraft.length, loading, updatedAt]);

  // Fetch the aircraft's previous flights when selected (or the day range changes).
  // Drawing is handled separately so the user can step through them one at a time.
  useEffect(() => {
    setReplayFlight(null);
    if (!selectedTail) { setPrevFlights([]); return; }
    let alive = true;
    (async () => {
      try {
        const res = await fetchPreviousFlights(selectedTail, prevDays);
        if (!alive) return;
        setPrevFlights(res?.flights || []);
      } catch {
        if (alive) setPrevFlights([]);
      }
    })();
    return () => { alive = false; };
  }, [selectedTail, prevDays]);

  // Replay: fly a ghost plane along a previous flight's recorded track ("glimpse
  // into the past"). A faint full path is drawn, with a bright trail growing
  // behind the moving plane. Restart by bumping replayNonce.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (replayRafRef.current) { cancelAnimationFrame(replayRafRef.current); replayRafRef.current = null; }
    if (prevLayerRef.current) { prevLayerRef.current.remove(); prevLayerRef.current = null; }
    setReplayPct(0); setReplayDone(false);
    const track = replayFlight?.track;
    if (!map || !track || track.length < 2) return;

    const planned = !!replayFlight.planned;
    const trailColor = planned ? '#a855f7' : '#38bdf8';   // planned = purple, flown = blue
    const planeColor = planned ? '#a855f7' : '#f59e0b';
    const group = L.layerGroup().addTo(map);
    prevLayerRef.current = group;
    L.polyline(track, { color: trailColor, weight: 1.5, opacity: 0.28, dashArray: planned ? '5 7' : null }).addTo(group);
    // Airport stops along a multi-leg trip.
    for (const wp of (replayFlight.waypoints || [])) {
      if (wp) L.circleMarker(wp, { radius: 3.5, color: '#94a3b8', weight: 1.5, fillColor: '#0b0f17', fillOpacity: 1, interactive: false }).addTo(group);
    }
    const trail = L.polyline([track[0]], { color: trailColor, weight: 3, opacity: 0.9, dashArray: planned ? '5 7' : null }).addTo(group);
    const plane = L.marker(track[0], { icon: createAircraftIcon(planeColor, true, bearing(track[0], track[1])), interactive: false, zIndexOffset: 1000 }).addTo(group);
    const finite = track.filter(pt => Array.isArray(pt) && Number.isFinite(pt[0]) && Number.isFinite(pt[1]));
    if (finite.length >= 2) map.fitBounds(L.latLngBounds(finite), { padding: [70, 70], maxZoom: 9 });

    // Arc-length parameterization: animate by DISTANCE travelled, not point index,
    // so the plane moves at a constant visual speed even though ADS-B logs points
    // densely in taxi/climb and sparsely in cruise (the cause of slow-then-fast).
    const segDist = (a, b) => { const dLat = b[0] - a[0]; const dLng = (b[1] - a[1]) * Math.cos((a[0] + b[0]) * Math.PI / 360); return Math.sqrt(dLat * dLat + dLng * dLng); };
    const cum = [0];
    for (let k = 1; k < track.length; k++) cum[k] = cum[k - 1] + segDist(track[k - 1], track[k]);
    const totalLen = cum[track.length - 1] || 1;

    const DURATION = 8000;
    const LOOK = 3;            // points to look ahead when computing heading (smooths noisy fixes)
    let start = null, lastPct = -1, seg = 0, hdg = bearing(track[0], track[Math.min(LOOK, track.length - 1)]);
    // Rotate the marker's existing element instead of rebuilding the icon each frame
    // (setIcon every frame is what made the plane flicker/glitch).
    const rotate = (deg) => {
      const el = plane.getElement();
      const inner = el && el.firstElementChild;
      if (inner) inner.style.transform = `rotate(${deg}deg)`;
    };
    rotate(hdg);
    const tick = (ts) => {
      if (start == null) start = ts;
      const p = Math.min((ts - start) / DURATION, 1);
      const dist = p * totalLen;
      // Advance the segment pointer to where cumulative distance reaches `dist`.
      while (seg < track.length - 2 && cum[seg + 1] < dist) seg++;
      const i = seg;
      const segLen = cum[i + 1] - cum[i];
      const frac = segLen > 0 ? Math.min((dist - cum[i]) / segLen, 1) : 0;
      const a = track[i], b = track[i + 1];
      const lat = a[0] + (b[0] - a[0]) * frac, lng = a[1] + (b[1] - a[1]) * frac;
      plane.setLatLng([lat, lng]);
      // Heading: aim a few points ahead from the live position, then ease toward it
      // (shortest angular path) so jittery ADS-B samples don't snap the nose around.
      const tgt = track[Math.min(i + LOOK, track.length - 1)];
      if (tgt[0] !== lat || tgt[1] !== lng) {
        const want = bearing([lat, lng], tgt);
        const d = ((want - hdg + 540) % 360) - 180;
        hdg = (hdg + d * 0.25 + 360) % 360;
        rotate(hdg);
      }
      trail.setLatLngs([...track.slice(0, i + 1), [lat, lng]]);
      const pct = Math.round(p * 100);
      if (pct !== lastPct) { lastPct = pct; setReplayPct(pct); }
      if (p < 1) { replayRafRef.current = requestAnimationFrame(tick); }
      else { plane.setLatLng(track[track.length - 1]); setReplayDone(true); }
    };
    replayRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (replayRafRef.current) { cancelAnimationFrame(replayRafRef.current); replayRafRef.current = null; }
      if (prevLayerRef.current) { prevLayerRef.current.remove(); prevLayerRef.current = null; }
    };
  }, [replayFlight, replayNonce]);

  const flyTo = (ac) => {
    setSelected(ac);
    setSelectedTail(ac.tail);
    mapInstanceRef.current?.flyTo([ac.position.lat, ac.position.lng], 7, { duration: 1.2 });
  };

  const fmtTime = ms => ms ? new Date(ms).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>Fleet Map</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '3px' }}>
            {loading
              ? 'Loading...'
              : `${aircraft.length} aircraft tracked · ${liveCount} live (ADS-B), ${aircraft.length - liveCount} scheduled`}
            {updatedAt && (
              <span style={{ color: 'var(--text-secondary)' }}>
                {' · '}Live as of {new Date(updatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          {[
            { color: '#f59e0b', label: 'In flight' },
            { color: '#22c55e', label: 'On ground' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: color }} />
              {label}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '16px', height: '65vh', minHeight: '400px' }}>

        {/* Left sidebar: Fleet roster / flight History */}
        <div style={{ width: '220px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' }}>
          {/* Aircraft picker (replaces the Fleet tab) */}
          <select
            value={selectedTail || ''}
            onChange={(e) => { const t = e.target.value || null; const ac = aircraft.find(a => a.tail === t); if (ac) flyTo(ac); else { setSelectedTail(t); setSelected(null); } }}
            style={{ fontSize: 13, fontWeight: 600, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
            <option value="">Select aircraft…</option>
            {aircraft.map(ac => <option key={ac.tail} value={ac.tail}>{ac.tail} · {ac.statusLabel}</option>)}
          </select>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>History</span>
            <select value={prevDays} onChange={e => setPrevDays(Number(e.target.value))}
              style={{ fontSize: 11, padding: '3px 5px', borderRadius: 6, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
              <option value={7}>7d</option><option value={30}>30d</option><option value={90}>90d</option><option value={365}>1yr</option>
            </select>
          </div>

          {!selectedTail ? (
            <div style={{ padding: '14px 10px', color: 'var(--text-secondary)', fontSize: '12px', lineHeight: 1.5 }}>
              Pick an aircraft above to see its flown and upcoming trips.
            </div>
          ) : (() => {
            const now = Date.now();
            const fmt = (ms) => (ms ? new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

            // Flown trips: past flights with real ADS-B tracks, grouped by trip.
            const flownByTrip = new Map();
            for (const f of prevFlights.filter(f => f.track && f.track.length >= 2)) {
              const key = f.tripId != null ? `t${f.tripId}` : `l${f.legId}`;
              if (!flownByTrip.has(key)) flownByTrip.set(key, { key, tripId: f.tripId, legs: [] });
              flownByTrip.get(key).legs.push(f);
            }
            const flown = [...flownByTrip.values()].map(t => {
              const ls = t.legs.sort((a, b) => (a.depTime || 0) - (b.depTime || 0));
              return { key: t.key, tripId: t.tripId, planned: false, legs: ls,
                route: [ls[0].from, ...ls.map(l => l.to)].filter(Boolean).join(' → '),
                depTime: ls[0].depTime, track: ls.flatMap(l => l.track),
                waypoints: [ls[0].track[0], ...ls.map(l => l.track[l.track.length - 1])] };
            }).sort((a, b) => (b.depTime || 0) - (a.depTime || 0));
            const flownTripIds = new Set(flown.map(t => t.tripId).filter(v => v != null));

            // Upcoming trips: future scheduled legs for this tail, drawn as planned
            // great-circle paths. They convert to the real flown track automatically
            // once flown (the leg leaves this future set and appears in `flown`).
            const futByTrip = new Map();
            for (const l of legs.filter(l => l.dispatch?.aircraft?.tailNumber === selectedTail && (l.departure?.time || 0) > now && l._calc?.from?.location && l._calc?.to?.location)) {
              const tid = l.dispatch?.tripId;
              if (tid != null && flownTripIds.has(tid)) continue;
              const key = tid != null ? `t${tid}` : `l${l._id?.$oid}`;
              if (!futByTrip.has(key)) futByTrip.set(key, { key, tripId: tid, legs: [] });
              futByTrip.get(key).legs.push(l);
            }
            const upcoming = [...futByTrip.values()].map(t => {
              const ls = t.legs.sort((a, b) => (a.departure?.time || 0) - (b.departure?.time || 0));
              const segs = ls.map(l => gcPath(l._calc.from.location, l._calc.to.location));
              return { key: t.key, tripId: t.tripId, planned: true, legs: ls,
                route: [ls[0].departure?.airport, ...ls.map(l => l.arrival?.airport)].filter(Boolean).join(' → '),
                depTime: ls[0].departure?.time, track: segs.flat(),
                waypoints: [segs[0][0], ...segs.map(s => s[s.length - 1])] };
            }).sort((a, b) => (a.depTime || 0) - (b.depTime || 0));

            const card = (t) => {
              const active = replayFlight?.legId === t.key;
              const accent = t.planned ? '#a855f7' : '#f59e0b';
              return (
                <div key={t.key} onClick={() => { setReplayFlight({ legId: t.key, track: t.track, waypoints: t.waypoints, planned: t.planned }); setReplayNonce(n => n + 1); }}
                  style={{ background: active ? 'rgba(79,142,247,0.12)' : 'var(--bg-card)', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, padding: '9px 11px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{t.route}</span>
                    {t.planned && <span style={{ fontSize: 9, fontWeight: 600, color: '#a855f7', background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.35)', borderRadius: 20, padding: '1px 7px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Planned</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{fmt(t.depTime)}{t.tripId != null ? ` · #${t.tripId}` : ''} · {t.legs.length} leg{t.legs.length === 1 ? '' : 's'}</div>
                  {active && (
                    <div style={{ marginTop: 7 }}>
                      <div style={{ height: 4, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                        <div style={{ width: `${replayPct}%`, height: '100%', background: accent }} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                        <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{replayDone ? (t.planned ? '● Route preview' : '● Trip complete') : `${t.planned ? 'Previewing' : 'Replaying'}… ${replayPct}%`}</span>
                        <button onClick={(e) => { e.stopPropagation(); setReplayNonce(n => n + 1); }}
                          style={{ padding: '3px 9px', fontSize: 11, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>↺ Replay</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            };

            const sub = (label) => <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '6px 2px 0' }}>{label}</div>;
            if (!upcoming.length && !flown.length) return <p style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '4px 2px' }}>{prevFlights.length ? 'No flown or upcoming trips in range.' : 'Loading…'}</p>;
            return (
              <>
                {upcoming.length > 0 && sub('Upcoming')}
                {upcoming.map(card)}
                {flown.length > 0 && sub('Flown')}
                {flown.map(card)}
              </>
            );
          })()}
        </div>

        {/* Map */}
        <div ref={mapWrapRef} className="exjet-map-wrap" style={{ overflow: 'hidden', ...(cssFs ? { position: 'fixed', inset: 0, zIndex: 9999, borderRadius: 0, border: 'none', background: 'var(--bg-primary)' } : { flex: 1, borderRadius: '12px', border: '1px solid var(--border)', position: 'relative' }) }}>
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

          {/* Bottom-left of the map container — lifted above the selected-
              aircraft detail card when it's open so they don't overlap. */}
          <button onClick={toggleFs} title={isFs ? 'Exit full screen (Esc)' : 'Full screen'} style={{ position: 'absolute', bottom: selectedAc ? 140 : 20, left: 20, zIndex: 1001, padding: '6px 12px', fontSize: 13, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}>
            {isFs ? '⤧ Exit full screen' : '⤢ Full screen'}
          </button>

          <button onClick={() => setShowTrail(s => !s)} style={{ position: 'absolute', top: 12,
            right: 12, zIndex: 1000, padding: '6px 12px', fontSize: 13, borderRadius: 8, cursor: 'pointer',
            border: '1px solid var(--border)',
            background: showTrail ? 'var(--accent)' : 'var(--bg-secondary)',
            color: showTrail ? '#fff' : 'var(--text-primary)' }}>
            {showTrail ? 'Flight trail: On' : 'Flight trail: Off'}
          </button>

          {/* Previous flights now live in the left "History" tab, with replay. */}

          {/* Selected aircraft detail card */}
          {selectedAc && (
            <div style={{
              position: 'absolute', bottom: '16px', left: '16px', right: '16px',
              background: 'rgba(10,10,15,0.92)', border: '1px solid var(--border)',
              borderRadius: '12px', padding: '14px 16px',
              backdropFilter: 'blur(8px)', zIndex: 1000,
              display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-start',
            }}>
              <div style={{ flex: 1, minWidth: '140px' }}>
                <p style={{ fontSize: '18px', fontWeight: '700', color: 'var(--accent)', margin: '0 0 2px' }}>{selectedAc.tail}</p>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>{selectedAc.type}</p>
              </div>
              <div style={{ flex: 1, minWidth: '140px' }}>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 3px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</p>
                <p style={{ fontSize: '13px', color: selectedAc.statusColor, fontWeight: '600', margin: 0 }}>● {selectedAc.statusLabel}</p>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{selectedAc.airport}</p>
              </div>
              {selectedAc.live && (
                <div style={{ flex: 1, minWidth: '150px' }}>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 3px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Live (ADS-B)</p>
                  <p style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: '500', margin: 0 }}>
                    {selectedAc.live.altitudeFt != null ? `${selectedAc.live.altitudeFt.toLocaleString()} ft` : '—'}
                    {selectedAc.live.groundSpeedKt != null ? ` · ${Math.round(selectedAc.live.groundSpeedKt)} kt` : ''}
                  </p>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {selectedAc.live.callsign || selectedAc.tail}
                    {selectedAc.live.track != null ? ` · hdg ${Math.round(selectedAc.live.track)}°` : ''}
                  </p>
                  {selectedAc.isFlying && (
                    <FlyingTimer
                      sinceMs={live[selectedAc.tail]?.airborneSinceMs}
                      style={{ display: 'inline-block', marginTop: '4px', fontSize: '12px', fontWeight: 600, color: '#f59e0b' }}
                    />
                  )}
                </div>
              )}
              {selectedAc.currentLeg && (
                <div style={{ flex: 1, minWidth: '160px' }}>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 3px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {selectedAc.isFlying ? 'Current flight' : 'Last flight'}
                  </p>
                  <p style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: '500', margin: 0 }}>
                    {selectedAc.currentLeg.departure?.airport} → {selectedAc.currentLeg.arrival?.airport}
                  </p>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {selectedAc.currentLeg.dispatch?.client?.company?.name || 'No client'}
                  </p>
                </div>
              )}
              {selectedAc.nextFlight && (
                <div style={{ flex: 1, minWidth: '160px' }}>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 3px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Next flight</p>
                  <p style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: '500', margin: 0 }}>
                    {selectedAc.nextFlight.departure?.airport} → {selectedAc.nextFlight.arrival?.airport}
                  </p>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{fmtTime(selectedAc.nextFlight.departure?.time)}</p>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                <button
                  onClick={() => { if (selectedAc.currentLeg) navigate(`/flights/${selectedAc.currentLeg._id?.$oid}`, { state: { leg: selectedAc.currentLeg } }); }}
                  style={{ padding: '6px 12px', fontSize: '12px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '7px', cursor: 'pointer' }}
                >View flight →</button>
                <button onClick={() => { setSelected(null); setSelectedTail(null); }} style={{ padding: '6px 12px', fontSize: '12px', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: '7px', cursor: 'pointer' }}>
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .aircraft-icon { background: transparent; border: none; }
        .exjet-map-wrap:fullscreen { border-radius: 0; border: none; background: var(--bg-primary); }
        .exjet-tooltip {
          background: #0a0a0f !important;
          border: 1px solid #2a2a3a !important;
          border-radius: 8px !important;
          color: #f0f0f5 !important;
          font-size: 12px !important;
          padding: 6px 10px !important;
          box-shadow: 0 4px 16px rgba(0,0,0,0.4) !important;
        }
        .exjet-tooltip::before { display: none !important; }
        .leaflet-control-zoom a {
          background: #1a1a24 !important;
          color: #f0f0f5 !important;
          border-color: #2a2a3a !important;
        }
        .leaflet-control-attribution {
          background: rgba(10,10,15,0.7) !important;
          color: #8888a0 !important;
          font-size: 10px !important;
        }
      `}</style>
    </div>
  );
}
