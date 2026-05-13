import { useApi } from '../hooks/useApi';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const STATUS = {
  0: { bg: '#4f8ef7', label: 'Scheduled' },
  1: { bg: '#f59e0b', label: 'Active' },
  2: { bg: '#a855f7', label: 'Booked' },
  3: { bg: '#22c55e', label: 'Completed' },
};

const VIEWS = {
  day:   { label: 'Day',   colMs: 3600000,  cols: 48,  colW: 80,  stepMs: 86400000  },
  week:  { label: 'Week',  colMs: 86400000, cols: 21,  colW: 150, stepMs: 604800000  },
  month: { label: 'Month', colMs: 86400000, cols: 90,  colW: 40,  stepMs: 2592000000 },
  year:  { label: 'Year',  colMs: 86400000, cols: 365, colW: 16,  stepMs: 31536000000},
};

const ROW_H   = 64;
const HDR_H   = 48;
const LABEL_W = 120;

const floorDay  = ts => { const d = new Date(ts); d.setHours(0,0,0,0); return d.getTime(); };
const floorHour = ts => { const d = new Date(ts); d.setMinutes(0,0,0); return d.getTime(); };

const buildTrips = legs => {
  const map = {};
  legs.forEach(leg => {
    const id = String(leg.dispatch?.tripId || leg._id?.$oid);
    if (!map[id]) map[id] = { id, legs: [], tail: leg.dispatch?.aircraft?.tailNumber, client: leg.dispatch?.client?.company?.name };
    map[id].legs.push(leg);
  });
  return Object.values(map).map(t => {
    const s = [...t.legs].sort((a, b) => (a.departure?.time || 0) - (b.departure?.time || 0));
    const seen = new Set(), airports = [];
    s.forEach((l, i) => {
      const dep = l.departure?.airport, arr = l.arrival?.airport;
      if (i === 0 && dep && !seen.has(dep)) { seen.add(dep); airports.push(dep); }
      if (arr && !seen.has(arr)) { seen.add(arr); airports.push(arr); }
    });
    const worst = Math.min(...s.map(l => l.status ?? 99));
    return { ...t, s, firstLeg: s[0], route: airports.join(' → '),
      dep: s[0]?.departure?.time, arr: s[s.length - 1]?.arrival?.time,
      status: worst === 99 ? 0 : worst,
      mins: s.reduce((a, l) => a + (l._calc?._minutes || 0), 0) };
  });
};

const fmt = ts => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export default function Calendar() {
  const { data, loading } = useApi('/api/levelflight/legs');
  const navigate = useNavigate();
  const [view, setView]     = useState('week');
  const [offset, setOffset] = useState(0);
  const [hovered, setHovered]   = useState(null);
  const [tipPos, setTipPos]     = useState({ x: 0, y: 0 });
  const bodyRef = useRef(null);
  const hdrRef  = useRef(null);
  const drag    = useRef({ on: false, startX: 0, scrollX: 0, moved: false });

  const cfg     = VIEWS[view];
  const totalMs = cfg.cols * cfg.colMs;
  const totalW  = cfg.cols * cfg.colW;

  const baseStart = view === 'day'
    ? floorHour(Date.now()) - Math.floor(cfg.cols / 2) * cfg.colMs
    : floorDay(Date.now())  - Math.floor(cfg.cols / 2) * cfg.colMs;

  const rangeStart = baseStart + offset * cfg.stepMs;
  const rangeEnd   = rangeStart + totalMs;

  const goToToday = useCallback(() => {
    setOffset(0);
    setTimeout(() => {
      const el = bodyRef.current;
      if (!el) return;
      const nowPx = ((Date.now() - rangeStart) / totalMs) * totalW;
      el.scrollLeft = Math.max(0, nowPx - el.clientWidth / 2);
    }, 80);
  }, [rangeStart, totalMs, totalW]);

  const scrollToCenter = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const nowPx = ((Date.now() - rangeStart) / totalMs) * totalW;
    el.scrollLeft = Math.max(0, nowPx - el.clientWidth / 2);
  }, [rangeStart, totalMs, totalW]);

  useEffect(() => {
    const t = setTimeout(scrollToCenter, 120);
    return () => clearTimeout(t);
  }, [scrollToCenter, loading, view]);

  const onPD = useCallback(e => {
    const el = bodyRef.current;
    if (!el) return;
    drag.current = { on: true, startX: e.clientX, scrollX: el.scrollLeft, moved: false };
    el.setPointerCapture(e.pointerId);
    el.style.cursor = 'grabbing';
  }, []);

  const onPM = useCallback(e => {
    if (!drag.current.on) return;
    const delta = drag.current.startX - e.clientX;
    if (Math.abs(delta) > 4) drag.current.moved = true;
    if (bodyRef.current) bodyRef.current.scrollLeft = drag.current.scrollX + delta;
  }, []);

  const onPU = useCallback(() => {
    drag.current.on = false;
    if (bodyRef.current) bodyRef.current.style.cursor = 'grab';
    setTimeout(() => { drag.current.moved = false; }, 60);
  }, []);

  const legs = data?.legs || [];
  const acMap = {};
  legs.forEach(leg => {
    const tail = leg.dispatch?.aircraft?.tailNumber;
    if (!tail) return;
    if (!acMap[tail]) acMap[tail] = { tail, type: leg.dispatch?.aircraft?.type?.name, legs: [] };
    acMap[tail].legs.push(leg);
  });
  const aircraft = Object.values(acMap).sort((a, b) => a.tail.localeCompare(b.tail));

  const getBlock = (dep, arr) => {
    if (!dep || !arr || arr < rangeStart || dep > rangeEnd) return null;
    const left  = ((Math.max(dep, rangeStart) - rangeStart) / totalMs) * totalW;
    const width = Math.max(((Math.min(arr, rangeEnd) - Math.max(dep, rangeStart)) / totalMs) * totalW, 3);
    return { left, width };
  };

  const nowPx   = ((Date.now() - rangeStart) / totalMs) * totalW;
  const showNow = nowPx >= 0 && nowPx <= totalW;

  const cols = Array.from({ length: cfg.cols }, (_, i) => {
    const ts = rangeStart + i * cfg.colMs;
    const d  = new Date(ts);
    const isToday      = floorDay(ts) === floorDay(Date.now());
    const isMonthStart = d.getDate() === 1;
    const isWeekend    = d.getDay() === 0 || d.getDay() === 6;
    let label = '';
    if (view === 'day') {
      const h = d.getHours();
      if (i % 3 === 0) label = h === 0 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`;
    } else if (view === 'week') {
      label = `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.getDate()}`;
    } else if (view === 'month') {
      label = isMonthStart ? d.toLocaleDateString('en-US', { month: 'short' })
        : d.getDate() % 7 === 0 ? String(d.getDate()) : '';
    } else {
      label = isMonthStart ? d.toLocaleDateString('en-US', { month: 'short' }) : '';
    }
    return { i, ts, label, isToday, isMonthStart, isWeekend };
  });

  const rangeLabel = `${fmt(rangeStart)} — ${fmt(rangeEnd)}`;

  const navBtn = (label, onClick) => (
    <button onClick={onClick} style={{
      padding: '7px 12px', fontSize: '13px', fontWeight: '500',
      background: 'var(--bg-card)', color: 'var(--text-secondary)',
      border: '1px solid var(--border)', borderRadius: '7px', cursor: 'pointer',
      transition: 'background .15s, color .15s',
    }}
      onMouseEnter={e => { e.target.style.background = 'var(--border)'; e.target.style.color = 'var(--text-primary)'; }}
      onMouseLeave={e => { e.target.style.background = 'var(--bg-card)'; e.target.style.color = 'var(--text-secondary)'; }}
    >{label}</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%', maxWidth: '100%', overflow: 'hidden', boxSizing: 'border-box' }}>

      {/* TOP BAR */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', width: '100%' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>Operations Calendar</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '3px' }}>
            {loading ? 'Loading...' : `${aircraft.length} aircraft · ${legs.length} legs`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
            {Object.entries(VIEWS).map(([k, { label }]) => (
              <button key={k} onClick={() => { setView(k); setOffset(0); }} style={{
                padding: '7px 14px', fontSize: '13px', border: 'none', cursor: 'pointer',
                background: view === k ? 'var(--accent)' : 'var(--bg-card)',
                color: view === k ? '#fff' : 'var(--text-secondary)',
                fontWeight: view === k ? '600' : '400',
                transition: 'background .15s, color .15s',
              }}>{label}</button>
            ))}
          </div>
          <button onClick={goToToday} style={{
            padding: '7px 16px', fontSize: '13px', fontWeight: '600',
            background: 'var(--accent)', color: '#fff',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
          }}>Today</button>
        </div>
      </div>

      {/* NAV ROW — prev/next + date range label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        {navBtn('← Prev', () => setOffset(o => o - 1))}
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)', flex: 1, textAlign: 'center', whiteSpace: 'nowrap' }}>
          {rangeLabel}
        </span>
        {navBtn('Next →', () => setOffset(o => o + 1))}
      </div>

      {/* LEGEND */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        {Object.values(STATUS).map(({ bg, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--text-secondary)' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: bg, flexShrink: 0 }} />
            {label}
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--text-secondary)' }}>
          <div style={{ width: '2px', height: '12px', background: 'var(--danger)', borderRadius: '1px' }} />
          Now
        </div>
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)', marginLeft: 'auto' }}>drag timeline · click block to open</span>
      </div>

      {/* CALENDAR */}
      <div style={{ border: '1px solid var(--border)', borderRadius: '12px', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', overflow: 'hidden', width: '100%', boxSizing: 'border-box' }}>

        {/* HEADER */}
        <div style={{ display: 'flex', borderBottom: '2px solid var(--border)', flexShrink: 0 }}>
          <div style={{ width: LABEL_W, minWidth: LABEL_W, height: HDR_H, background: 'var(--bg-secondary)', borderRight: '2px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 14px', flexShrink: 0 }}>
            <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Aircraft</span>
          </div>
          <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
            <div ref={hdrRef} style={{ overflowX: 'hidden', width: '100%' }}>
              <div style={{ display: 'flex', width: totalW, height: HDR_H }}>
                {cols.map(col => (
                  <div key={col.i} style={{
                    width: cfg.colW, minWidth: cfg.colW, height: HDR_H,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRight: col.isMonthStart ? '2px solid rgba(255,255,255,0.16)' : '1px solid rgba(255,255,255,0.04)',
                    background: col.isToday ? 'rgba(79,142,247,0.12)' : 'transparent',
                    flexShrink: 0, overflow: 'hidden',
                  }}>
                    {col.label && (
                      <span style={{
                        fontSize: view === 'year' ? '9px' : view === 'month' ? '10px' : '12px',
                        fontWeight: col.isToday || col.isMonthStart ? '700' : '400',
                        color: col.isToday ? 'var(--accent)' : col.isMonthStart ? '#dde' : 'var(--text-secondary)',
                        whiteSpace: 'nowrap',
                      }}>{col.label}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* BODY */}
        <div style={{ display: 'flex', overflow: 'hidden', maxHeight: '60vh' }}>
          <div style={{ width: LABEL_W, minWidth: LABEL_W, flexShrink: 0, borderRight: '2px solid var(--border)', overflowY: 'hidden' }} id="lbl-col">
            {aircraft.map((ac, i) => (
              <div key={ac.tail} style={{ height: ROW_H, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 14px', borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--bg-card)' : '#111119', flexShrink: 0 }}>
                <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--accent)' }}>{ac.tail}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '3px' }}>{ac.type?.replace('Gulfstream ', 'G') || '—'}</span>
              </div>
            ))}
          </div>

          <div
            ref={bodyRef}
            onPointerDown={onPD}
            onPointerMove={onPM}
            onPointerUp={onPU}
            onPointerCancel={onPU}
            onScroll={e => {
              if (hdrRef.current) hdrRef.current.scrollLeft = e.target.scrollLeft;
              const lbl = document.getElementById('lbl-col');
              if (lbl) lbl.scrollTop = e.target.scrollTop;
            }}
            style={{ flex: 1, minWidth: 0, overflowX: 'scroll', overflowY: 'auto', cursor: 'grab', WebkitOverflowScrolling: 'touch' }}
          >
            <div style={{ width: totalW, position: 'relative' }}>
              {loading ? (
                <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '14px' }}>Loading flights...</div>
              ) : aircraft.length === 0 ? (
                <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '14px' }}>No flights found for this period</div>
              ) : aircraft.map((ac, rowIdx) => {
                const trips = buildTrips(ac.legs);
                const rowBg = rowIdx % 2 === 0 ? 'var(--bg-card)' : '#111119';
                return (
                  <div key={ac.tail} style={{ position: 'relative', height: ROW_H, borderBottom: '1px solid var(--border)', background: rowBg }}>
                    {cols.map(col => (
                      <div key={col.i} style={{ position: 'absolute', left: col.i * cfg.colW, top: 0, bottom: 0, width: col.isMonthStart ? 2 : 1, background: col.isMonthStart ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.03)', pointerEvents: 'none' }} />
                    ))}
                    {cols.filter(c => c.isToday).map(col => (
                      <div key={col.i} style={{ position: 'absolute', left: col.i * cfg.colW, top: 0, bottom: 0, width: cfg.colW, background: 'rgba(79,142,247,0.05)', pointerEvents: 'none' }} />
                    ))}
                    {showNow && (
                      <div style={{ position: 'absolute', left: nowPx, top: 0, bottom: 0, width: 2, background: 'var(--danger)', boxShadow: '0 0 6px rgba(239,68,68,0.5)', zIndex: 4, pointerEvents: 'none' }}>
                        {rowIdx === 0 && (
                          <div style={{ position: 'absolute', top: 4, left: 4, background: 'var(--danger)', borderRadius: '3px', padding: '2px 5px', fontSize: '9px', color: '#fff', fontWeight: '700', whiteSpace: 'nowrap' }}>NOW</div>
                        )}
                      </div>
                    )}
                    {trips.map((trip, ti) => {
                      const blk = getBlock(trip.dep, trip.arr);
                      if (!blk) return null;
                      const color = STATUS[trip.status]?.bg || '#666';
                      const isHov = hovered?.id === trip.id;
                      const multi = trip.s.length > 1;
                      return (
                        <div key={trip.id || ti}
                          onClick={() => { if (drag.current.moved) return; navigate(`/flights/${trip.firstLeg._id?.$oid}`, { state: { leg: trip.firstLeg } }); }}
                          onMouseEnter={e => { setHovered(trip); setTipPos({ x: e.clientX, y: e.clientY }); }}
                          onMouseMove={e => setTipPos({ x: e.clientX, y: e.clientY })}
                          onMouseLeave={() => setHovered(null)}
                          style={{
                            position: 'absolute', left: blk.left + 2, top: 10,
                            width: Math.max(blk.width - 4, 3), height: ROW_H - 20,
                            background: color, borderRadius: view === 'year' ? '2px' : '5px',
                            cursor: 'pointer', opacity: isHov ? 1 : 0.87,
                            boxShadow: isHov ? `0 2px 12px ${color}99` : `inset 0 0 0 1px ${color}44`,
                            zIndex: isHov ? 5 : 2, display: 'flex', alignItems: 'center',
                            overflow: 'hidden', padding: blk.width > 24 ? '0 7px' : '0 2px',
                            gap: '4px', transition: 'opacity .1s, box-shadow .1s',
                          }}
                        >
                          {multi && blk.width > 14 && <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#fff', opacity: .9, flexShrink: 0 }} />}
                          {blk.width > 44 && <span style={{ fontSize: '11px', color: '#fff', fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{trip.route}</span>}
                          {multi && blk.width > 120 && <span style={{ fontSize: '10px', color: 'rgba(255,255,255,.7)', whiteSpace: 'nowrap' }}>({trip.s.length})</span>}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {hovered && (
        <div style={{ position: 'fixed', left: Math.min(tipPos.x + 16, window.innerWidth - 260), top: Math.min(tipPos.y - 8, window.innerHeight - 230), background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 16px', zIndex: 9999, boxShadow: '0 8px 32px rgba(0,0,0,.6)', pointerEvents: 'none', width: '240px' }}>
          <p style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '10px' }}>{hovered.route}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '10px' }}>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>✈ {hovered.tail} · Trip #{hovered.id}</p>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{hovered.s.length} leg{hovered.s.length > 1 ? 's' : ''}{hovered.mins > 0 ? ` · ${Math.floor(hovered.mins / 60)}h ${hovered.mins % 60}m` : ''}</p>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              {new Date(hovered.dep).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {' → '}
              {new Date(hovered.arr).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{hovered.client || 'No client'}</p>
          </div>
          <div style={{ paddingTop: '10px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: '600', color: STATUS[hovered.status]?.bg }}>● {STATUS[hovered.status]?.label}</span>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Click to open →</span>
          </div>
        </div>
      )}
    </div>
  );
}
