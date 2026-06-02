import { useApi } from '../hooks/useApi';
import { useAdsb } from '../hooks/useAdsb';
import { useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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

    const dep = leg.departure?.time;
    const arr = leg.arrival?.time;

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
    const lastCompleted = sorted.find(l => l.status === 3 && l.arrival?.time <= now);
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

export default function Map() {
  const { data, loading } = useApi('/api/levelflight/legs');
  const [showTrail, setShowTrail] = useState(false);
  const { positions: live, trails, updatedAt } = useAdsb(20000, showTrail);
  const navigate = useNavigate();
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const trailLayerRef = useRef(null);
  const didFitRef = useRef(false);
  const mapWrapRef = useRef(null);
  const [cssFs, setCssFs] = useState(false);      // CSS-maximize fallback when the Fullscreen API is unavailable
  const [nativeFs, setNativeFs] = useState(false);
  const [selected, setSelected] = useState(null);

  const legs = data?.legs || [];
  const scheduled = getAircraftPositions(legs);

  // Live ADS-B wins; aircraft with no live position keep their scheduled-leg
  // position (parked / transponder off), so they still show at last airport.
  const aircraft = scheduled.map(ac => {
    const l = live[ac.tail];
    if (l && l.lat != null && l.lon != null) {
      return {
        ...ac,
        position: { lat: l.lat, lng: l.lon },
        isFlying: !l.onGround,
        statusLabel: l.onGround ? 'On Ground · live' : 'In Flight · live',
        statusColor: l.onGround ? '#22c55e' : '#f59e0b',
        track: l.track,
        live: l,
        source: 'adsb',
      };
    }
    return { ...ac, source: 'scheduled' };
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

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      trailLayerRef.current = null;
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

    aircraft.forEach(ac => {
      const icon = createAircraftIcon(ac.statusColor, ac.isFlying, ac.track);
      const marker = L.marker([ac.position.lat, ac.position.lng], { icon })
        .addTo(map)
        .on('click', () => setSelected(ac));

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
      map.fitBounds(bounds, { padding: [80, 80] });
      didFitRef.current = true;
    }
  }, [aircraft.length, loading, updatedAt]);

  const flyTo = (ac) => {
    setSelected(ac);
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

        {/* Aircraft list sidebar */}
        <div style={{ width: '220px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: '16px', color: 'var(--text-secondary)', fontSize: '13px' }}>Loading...</div>
          ) : aircraft.length === 0 ? (
            <div style={{ padding: '16px', color: 'var(--text-secondary)', fontSize: '13px' }}>No aircraft found</div>
          ) : aircraft.map(ac => (
            <div key={ac.tail}
              onClick={() => flyTo(ac)}
              style={{
                background: selected?.tail === ac.tail ? 'rgba(79,142,247,0.1)' : 'var(--bg-card)',
                border: `1px solid ${selected?.tail === ac.tail ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: '10px', padding: '12px 14px',
                cursor: 'pointer', transition: 'all .15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '15px', fontWeight: '700', color: 'var(--accent)' }}>{ac.tail}</span>
                <span style={{
                  fontSize: '10px', fontWeight: '600', padding: '2px 7px',
                  borderRadius: '20px', background: `${ac.statusColor}22`,
                  color: ac.statusColor, border: `1px solid ${ac.statusColor}44`,
                }}>{ac.statusLabel}</span>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0 }}>{ac.type?.replace('Gulfstream ', 'G') || '—'}</p>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '3px' }}>{ac.airport || '—'}</p>
              <span style={{
                display: 'inline-block', marginTop: '6px', fontSize: '9px', fontWeight: '600',
                letterSpacing: '0.04em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: '20px',
                background: ac.source === 'adsb' ? 'rgba(34,197,94,0.12)' : 'rgba(136,136,160,0.12)',
                color: ac.source === 'adsb' ? '#22c55e' : 'var(--text-secondary)',
                border: `1px solid ${ac.source === 'adsb' ? 'rgba(34,197,94,0.4)' : 'var(--border)'}`,
              }}>{ac.source === 'adsb' ? 'Live · ADS-B' : 'Scheduled'}</span>
            </div>
          ))}
        </div>

        {/* Map */}
        <div ref={mapWrapRef} className="exjet-map-wrap" style={{ overflow: 'hidden', ...(cssFs ? { position: 'fixed', inset: 0, zIndex: 9999, borderRadius: 0, border: 'none', background: 'var(--bg-primary)' } : { flex: 1, borderRadius: '12px', border: '1px solid var(--border)', position: 'relative' }) }}>
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

          {/* Fixed bottom-right: sits above the Leaflet attribution and is
              raised above the selected-aircraft detail card when that card is
              open. Stays inside mapWrapRef so it's visible in native fullscreen. */}
          <button onClick={toggleFs} title={isFs ? 'Exit full screen (Esc)' : 'Full screen'} style={{ position: 'fixed', bottom: selectedAc ? 140 : 20, right: 20, zIndex: 10001, padding: '6px 12px', fontSize: 13, borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}>
            {isFs ? '⤧ Exit full screen' : '⤢ Full screen'}
          </button>

          <button onClick={() => setShowTrail(s => !s)} style={{ position: 'absolute', top: 12,
            right: 12, zIndex: 1000, padding: '6px 12px', fontSize: 13, borderRadius: 8, cursor: 'pointer',
            border: '1px solid var(--border)',
            background: showTrail ? 'var(--accent)' : 'var(--bg-secondary)',
            color: showTrail ? '#fff' : 'var(--text-primary)' }}>
            {showTrail ? 'Flight trail: On' : 'Flight trail: Off'}
          </button>

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
                <button onClick={() => setSelected(null)} style={{ padding: '6px 12px', fontSize: '12px', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: '7px', cursor: 'pointer' }}>
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
