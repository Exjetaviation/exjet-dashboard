import { useApi } from '../hooks/useApi';
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

const createAircraftIcon = (color, isFlying) => {
  const size = isFlying ? 36 : 32;
  const svg = isFlying
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="17" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="1.5"/>
        <text x="18" y="23" text-anchor="middle" font-size="18">✈</text>
      </svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
        <circle cx="16" cy="16" r="15" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="1.5"/>
        <circle cx="16" cy="16" r="6" fill="${color}"/>
      </svg>`;

  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
};

export default function Map() {
  const { data, loading } = useApi('/api/levelflight/legs');
  const navigate = useNavigate();
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const [selected, setSelected] = useState(null);

  const legs = data?.legs || [];
  const aircraft = getAircraftPositions(legs);

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

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || aircraft.length === 0) return;

    Object.values(markersRef.current).forEach(m => m.remove());
    markersRef.current = {};

    aircraft.forEach(ac => {
      const icon = createAircraftIcon(ac.statusColor, ac.isFlying);
      const marker = L.marker([ac.position.lat, ac.position.lng], { icon })
        .addTo(map)
        .on('click', () => setSelected(ac));

      marker.bindTooltip(`<strong>${ac.tail}</strong><br/>${ac.statusLabel} · ${ac.airport || ''}`, {
        permanent: false,
        className: 'exjet-tooltip',
        offset: [0, -10],
      });

      markersRef.current[ac.tail] = marker;
    });

    if (aircraft.length > 0) {
      const bounds = L.latLngBounds(aircraft.map(ac => [ac.position.lat, ac.position.lng]));
      map.fitBounds(bounds, { padding: [80, 80] });
    }
  }, [aircraft.length, loading]);

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
            {loading ? 'Loading...' : `${aircraft.length} aircraft tracked · positions based on latest flight data`}
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
            </div>
          ))}
        </div>

        {/* Map */}
        <div style={{ flex: 1, borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border)', position: 'relative' }}>
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

          {/* Selected aircraft detail card */}
          {selected && (
            <div style={{
              position: 'absolute', bottom: '16px', left: '16px', right: '16px',
              background: 'rgba(10,10,15,0.92)', border: '1px solid var(--border)',
              borderRadius: '12px', padding: '14px 16px',
              backdropFilter: 'blur(8px)', zIndex: 1000,
              display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-start',
            }}>
              <div style={{ flex: 1, minWidth: '140px' }}>
                <p style={{ fontSize: '18px', fontWeight: '700', color: 'var(--accent)', margin: '0 0 2px' }}>{selected.tail}</p>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>{selected.type}</p>
              </div>
              <div style={{ flex: 1, minWidth: '140px' }}>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 3px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</p>
                <p style={{ fontSize: '13px', color: selected.statusColor, fontWeight: '600', margin: 0 }}>● {selected.statusLabel}</p>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{selected.airport}</p>
              </div>
              {selected.currentLeg && (
                <div style={{ flex: 1, minWidth: '160px' }}>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 3px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {selected.isFlying ? 'Current flight' : 'Last flight'}
                  </p>
                  <p style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: '500', margin: 0 }}>
                    {selected.currentLeg.departure?.airport} → {selected.currentLeg.arrival?.airport}
                  </p>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {selected.currentLeg.dispatch?.client?.company?.name || 'No client'}
                  </p>
                </div>
              )}
              {selected.nextFlight && (
                <div style={{ flex: 1, minWidth: '160px' }}>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 3px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Next flight</p>
                  <p style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: '500', margin: 0 }}>
                    {selected.nextFlight.departure?.airport} → {selected.nextFlight.arrival?.airport}
                  </p>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{fmtTime(selected.nextFlight.departure?.time)}</p>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                <button
                  onClick={() => { if (selected.currentLeg) navigate(`/flights/${selected.currentLeg._id?.$oid}`, { state: { leg: selected.currentLeg } }); }}
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
