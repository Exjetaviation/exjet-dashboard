import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/api';

const DUTY_TYPES = {
  11: { label: 'Flight Duty', color: '#4f8ef7', bg: '#4f8ef722' },
  6:  { label: 'Day Off',     color: '#22c55e', bg: '#22c55e22' },
  10: { label: 'Training',    color: '#a855f7', bg: '#a855f722' },
  4:  { label: 'Standby',     color: '#f59e0b', bg: '#f59e0b22' },
  1:  { label: 'Sick',        color: '#ef4444', bg: '#ef444422' },
};

const fmt = (ts) => new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
const fmtDate = (ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const sameDay = (ts, d) => {
  const a = new Date(ts), b = new Date(d);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
};
const daysBetween = (startTs, endTs, dayDate) => {
  const day = new Date(dayDate);
  const start = new Date(startTs);
  const end = new Date(endTs || startTs);
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59);
  return start <= dayEnd && end >= dayStart;
};

export default function CrewCalendar() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [view, setView] = useState('all'); // 'all' | pilotId

  useEffect(() => {
    setLoading(true);
    apiFetch('/api/levelflight/pilot-calendar')
      .then(r => r.json())
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ padding: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '400px' }}>
      <p style={{ color: 'var(--text-secondary)' }}>Loading crew calendar...</p>
    </div>
  );

  if (!data) return (
    <div style={{ padding: '40px' }}>
      <p style={{ color: 'var(--text-secondary)' }}>No data available.</p>
    </div>
  );

  const legs = data.legs || [];
  const users = data.users || [];
  const notes = data.notes || [];

  // Build calendar month
  const now = new Date();
  const viewDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const monthName = viewDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const firstDayOfWeek = viewDate.getDay(); // 0=Sun

  // Pad to full weeks
  const calDays = [];
  for (let i = 0; i < firstDayOfWeek; i++) calDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    calDays.push(new Date(viewDate.getFullYear(), viewDate.getMonth(), d));
  }
  while (calDays.length % 7 !== 0) calDays.push(null);

  // Pilots only (have ratings)
  const pilots = users.filter(u => u.ratings?.length > 0);

  // Per-day events for a pilot
  const getDayEvents = (pilot, dayDate) => {
    if (!dayDate) return [];
    const events = [];

    // Duty periods
    (pilot.duties || []).forEach(duty => {
      if (daysBetween(duty.in, duty.out, dayDate)) {
        const dt = DUTY_TYPES[duty.type] || { label: `Type ${duty.type}`, color: '#888', bg: '#88888822' };
        events.push({
          type: 'duty',
          dutyType: duty.type,
          label: dt.label,
          color: dt.color,
          bg: dt.bg,
          in: duty.in,
          out: duty.out,
        });
      }
    });

    // Flight legs
    legs.forEach(leg => {
      const isPilot = (leg.pilots || []).some(p => p.user?._id?.$oid === pilot._id?.$oid);
      if (!isPilot) return;
      const depTime = leg.departure?.time;
      if (!depTime || !sameDay(depTime, dayDate)) return;
      events.push({
        type: 'leg',
        label: `${leg.departure?.airport} → ${leg.arrival?.airport}`,
        color: '#4f8ef7',
        bg: '#4f8ef711',
        time: fmt(depTime),
        depTime,
        arrTime: leg.arrival?.time,
        aircraft: leg.dispatch?.aircraft?.tailNumber,
        client: leg.dispatch?.client?.company?.name || '',
        pax: leg.passengerCount || 0,
        mins: leg._calc?.minutes || 0,
        legId: leg._id?.$oid,
      });
    });

    // Notes
    notes.forEach(note => {
      if (note.item?.$oid !== pilot._id?.$oid) return;
      if (daysBetween(note.start, note.end, dayDate)) {
        events.push({
          type: 'note',
          label: note.message,
          color: '#f59e0b',
          bg: '#f59e0b11',
        });
      }
    });

    return events;
  };

  const displayPilots = view === 'all' ? pilots : pilots.filter(p => p._id?.$oid === view);

  const styles = {
    page: { padding: '24px 28px', maxWidth: '1600px' },
    hdr: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' },
    title: { fontSize: '22px', fontWeight: '700', color: 'var(--text-primary)', margin: 0 },
    sub: { fontSize: '13px', color: 'var(--text-secondary)', margin: '4px 0 0' },
    controls: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
    btn: (active) => ({
      padding: '6px 14px', fontSize: '13px', border: '1px solid var(--border)',
      borderRadius: '8px', cursor: 'pointer', fontWeight: active ? '600' : '400',
      background: active ? 'var(--accent)' : 'var(--bg-card)',
      color: active ? '#fff' : 'var(--text-primary)',
    }),
    select: {
      padding: '6px 12px', fontSize: '13px', border: '1px solid var(--border)',
      borderRadius: '8px', background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer',
    },
    navBtn: {
      padding: '6px 12px', fontSize: '13px', border: '1px solid var(--border)',
      borderRadius: '8px', cursor: 'pointer', background: 'var(--bg-card)', color: 'var(--text-primary)',
    },
    monthLabel: { fontSize: '18px', fontWeight: '700', color: 'var(--text-primary)', minWidth: '200px', textAlign: 'center' },
    legend: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' },
    legendItem: () => ({ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--text-secondary)' }),
    legendDot: (color) => ({ width: '10px', height: '10px', borderRadius: '3px', background: color, flexShrink: 0 }),
  };

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.hdr}>
        <div>
          <h1 style={styles.title}>Crew Calendar</h1>
          <p style={styles.sub}>30-day scheduling · {pilots.length} crew members</p>
        </div>
        <div style={styles.controls}>
          <select style={styles.select} value={view} onChange={e => setView(e.target.value)}>
            <option value="all">All Crew</option>
            {pilots.map(p => (
              <option key={p._id?.$oid} value={p._id?.$oid}>
                {p.firstName?.trim()} {p.lastName}
              </option>
            ))}
          </select>
          <button style={styles.navBtn} onClick={() => setMonthOffset(o => o - 1)}>← Prev</button>
          <span style={styles.monthLabel}>{monthName}</span>
          <button style={styles.navBtn} onClick={() => setMonthOffset(o => o + 1)}>Next →</button>
          <button style={styles.navBtn} onClick={() => setMonthOffset(0)}>Today</button>
        </div>
      </div>

      {/* Legend */}
      <div style={styles.legend}>
        {Object.entries(DUTY_TYPES).map(([type, dt]) => (
          <div key={type} style={styles.legendItem(dt.color, dt.bg)}>
            <div style={styles.legendDot(dt.color)} />
            {dt.label}
          </div>
        ))}
        <div style={styles.legendItem('#4f8ef7')}>
          <div style={styles.legendDot('#4f8ef7')} />Flight leg
        </div>
        <div style={styles.legendItem('#f59e0b')}>
          <div style={styles.legendDot('#f59e0b')} />Note
        </div>
      </div>

      {/* Calendar per pilot */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {displayPilots.map(pilot => {
          const name = `${pilot.firstName?.trim()} ${pilot.lastName}`;
          const base = pilot.pilot?.base || '—';
          const seat = pilot.ratings?.[0]?.seats?.['Part 135'] || pilot.ratings?.[0]?.seats?.['Part 91'] || '—';
          const seatLabel = seat === 2 ? 'Captain' : seat === 3 ? 'First Officer' : 'Crew';

          return (
            <div key={pilot._id?.$oid} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
              {/* Pilot header */}
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-secondary)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--accent)22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '700', color: 'var(--accent)' }}>
                    {pilot.firstName?.trim()[0]}{pilot.lastName[0]}
                  </div>
                  <div>
                    <p style={{ margin: 0, fontWeight: '600', fontSize: '14px', color: 'var(--text-primary)' }}>{name}</p>
                    <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)' }}>{seatLabel} · Base {base}</p>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[6, 11, 10, 4].map(dtype => {
                    const hasDuty = (pilot.duties || []).some(d => d.type === dtype);
                    if (!hasDuty) return null;
                    const dt = DUTY_TYPES[dtype];
                    return (
                      <span key={dtype} style={{ fontSize: '11px', padding: '2px 7px', borderRadius: '5px', background: dt.bg, color: dt.color, fontWeight: '600' }}>
                        {dt.label}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Calendar grid */}
              <div style={{ padding: '12px' }}>
                {/* Day of week headers */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '4px' }}>
                  {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
                    <div key={d} style={{ textAlign: 'center', fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', padding: '4px 0' }}>{d}</div>
                  ))}
                </div>
                {/* Weeks */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
                  {calDays.map((dayDate, idx) => {
                    const isToday = dayDate && sameDay(dayDate.getTime(), now.getTime());
                    const isPast = dayDate && dayDate < new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    const events = getDayEvents(pilot, dayDate);

                    return (
                      <div key={idx} style={{
                        minHeight: '72px', borderRadius: '6px', padding: '4px',
                        background: dayDate ? (isToday ? 'var(--accent)11' : isPast ? 'var(--bg-secondary)' : 'var(--bg-secondary)') : 'transparent',
                        border: isToday ? '1px solid var(--accent)' : '1px solid transparent',
                        opacity: dayDate ? 1 : 0,
                      }}>
                        {dayDate && (
                          <>
                            <div style={{ fontSize: '12px', fontWeight: isToday ? '700' : '400', color: isToday ? 'var(--accent)' : isPast ? 'var(--text-secondary)' : 'var(--text-primary)', marginBottom: '3px' }}>
                              {dayDate.getDate()}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              {events.slice(0, 3).map((ev, ei) => (
                                <div key={ei}
                                  onClick={() => setSelectedEvent({ event: ev, pilot: name, date: fmtDate(dayDate.getTime()) })}
                                  style={{
                                    fontSize: '10px', padding: '1px 4px', borderRadius: '3px',
                                    background: ev.bg, color: ev.color,
                                    fontWeight: '600', cursor: 'pointer',
                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                    borderLeft: `2px solid ${ev.color}`,
                                  }}
                                  title={ev.label}
                                >
                                  {ev.type === 'leg' ? ev.label : ev.label}
                                </div>
                              ))}
                              {events.length > 3 && (
                                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', paddingLeft: '4px' }}>+{events.length - 3} more</div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Event detail modal */}
      {selectedEvent && (
        <div onClick={() => setSelectedEvent(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '24px', width: '360px', maxWidth: '90vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {selectedEvent.pilot} · {selectedEvent.date}
                </p>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: selectedEvent.event.color }}>
                  {selectedEvent.event.label}
                </h3>
              </div>
              <button onClick={() => setSelectedEvent(null)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '18px', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {selectedEvent.event.type === 'duty' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Type</span>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: selectedEvent.event.color }}>{selectedEvent.event.label}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Start</span>
                    <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{fmtDate(selectedEvent.event.in)} {fmt(selectedEvent.event.in)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>End</span>
                    <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{fmtDate(selectedEvent.event.out)} {fmt(selectedEvent.event.out)}</span>
                  </div>
                </>
              )}
              {selectedEvent.event.type === 'leg' && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Route</span>
                    <span style={{ fontSize: '13px', fontWeight: '600', color: '#4f8ef7' }}>{selectedEvent.event.label}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Departure</span>
                    <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{fmt(selectedEvent.event.depTime)}</span>
                  </div>
                  {selectedEvent.event.arrTime && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                      <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Arrival</span>
                      <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{fmt(selectedEvent.event.arrTime)}</span>
                    </div>
                  )}
                  {selectedEvent.event.aircraft && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                      <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Aircraft</span>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--accent)' }}>{selectedEvent.event.aircraft}</span>
                    </div>
                  )}
                  {selectedEvent.event.client && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                      <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Client</span>
                      <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{selectedEvent.event.client}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Flight time</span>
                    <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{Math.floor(selectedEvent.event.mins/60)}h {selectedEvent.event.mins%60}m</span>
                  </div>
                </>
              )}
              {selectedEvent.event.type === 'note' && (
                <div style={{ padding: '10px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-primary)' }}>{selectedEvent.event.label}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}