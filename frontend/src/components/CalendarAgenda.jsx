import React from 'react';
import { floorDay, legStateColor, STATE_COLORS } from '../lib/calendarLeg';
import { easternParts, zuluParts } from '../lib/easternTime';
import { delaySegments } from '../lib/delaySegments';

// "1430" → "14:30"
const hhmmColon = t => t ? `${String(t).slice(0, 2)}:${String(t).slice(2)}` : '—';

function formatDuration(minutes) {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

// Day header label — "Today · Mon Jun 29" for today, "Mon Jun 29" otherwise.
function dayHeader(dayTs, todayMid) {
  const d = new Date(dayTs);
  const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return dayTs === todayMid ? `Today · ${label}` : label;
}

/**
 * CalendarAgenda — phone agenda ("List") view for Calendar.jsx.
 *
 * Props:
 *   legs            – same legs array Calendar renders
 *   actuals         – actuals map keyed by leg._id.$oid
 *   onOpenLeg(leg)  – tap handler; navigates to the leg's detail page
 *   isAirborneForLeg(leg) → boolean – Calendar's own airborne determination
 */
export default function CalendarAgenda({ legs, actuals, onOpenLeg, isAirborneForLeg }) {
  const now = Date.now();
  const todayMid = floorDay(now);

  // Filter out legs missing a departure time and sort ascending.
  const sorted = [...(legs || [])]
    .filter(l => l?.departure?.time != null)
    .sort((a, b) => a.departure.time - b.departure.time);

  // Group by local calendar day.
  const dayMap = new Map();
  for (const leg of sorted) {
    const d = floorDay(leg.departure.time);
    if (!dayMap.has(d)) dayMap.set(d, []);
    dayMap.get(d).push(leg);
  }

  // Upcoming (>= today) ascending first, then past descending.
  const days = Array.from(dayMap.keys());
  const upcoming = days.filter(d => d >= todayMid).sort((a, b) => a - b);
  const past     = days.filter(d => d < todayMid).sort((a, b) => b - a);
  const orderedDays = [...upcoming, ...past];

  if (orderedDays.length === 0) {
    return (
      <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '14px' }}>
        No flights to show.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {orderedDays.map(dayTs => {
        const dayLegs = dayMap.get(dayTs);
        const isToday = dayTs === todayMid;

        return (
          <div key={dayTs} style={{ marginBottom: 8 }}>
            {/* Day section header */}
            <div style={{
              padding: '6px 16px',
              fontSize: '11px',
              fontWeight: '700',
              color: isToday ? 'var(--accent)' : 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              borderBottom: '1px solid var(--border)',
              background: 'var(--bg-secondary)',
              position: 'sticky',
              top: 0,
              zIndex: 2,
            }}>
              {dayHeader(dayTs, todayMid)}
            </div>

            {/* Cards */}
            {dayLegs.map((leg, li) => {
              const legId   = leg._id?.$oid;
              const act     = (legId && actuals?.[legId]) || {};
              const airborne = isAirborneForLeg(leg);
              const color    = legStateColor(leg, airborne, act, now);

              const dep = leg.departure?.time;
              const arr = leg.arrival?.time;

              // Eastern times
              const depEt = dep ? easternParts(new Date(dep)) : null;
              const arrEt = arr ? easternParts(new Date(arr)) : null;
              const depTimeEt = depEt ? hhmmColon(depEt.time) : '—';
              const arrTimeEt = arrEt ? hhmmColon(arrEt.time) : '—';

              // UTC / Zulu times
              const depZ = dep ? zuluParts(new Date(dep)) : null;
              const arrZ = arr ? zuluParts(new Date(arr)) : null;
              const depTimeZ = depZ ? hhmmColon(depZ.time) : '—';
              const arrTimeZ = arrZ ? hhmmColon(arrZ.time) : '—';

              // Route — show diversion when present
              const depIcao  = leg.departure?.airport || '?';
              const arrIcao  = leg.arrival?.airport   || '?';
              const diverted = !!act.divertedTo;
              const routeText = diverted
                ? `${depIcao} ⤳ ${act.divertedTo}`
                : `${depIcao} → ${arrIcao}`;

              const tail = leg.dispatch?.aircraft?.tailNumber || '—';

              // Delay / status badge
              let badge = null;
              if (airborne) {
                badge = { text: 'In flight', bg: `${STATE_COLORS.inflight}22`, border: `${STATE_COLORS.inflight}44`, color: STATE_COLORS.inflight };
              } else if (diverted) {
                badge = { text: '⤳ Diverted', bg: 'rgba(239,68,68,0.13)', border: 'rgba(239,68,68,0.35)', color: 'var(--danger)' };
              } else {
                try {
                  const segs = delaySegments({
                    dep, arr,
                    actualDep:  act.actualDep  ?? null,
                    actualArr:  act.actualArr  ?? null,
                    depSource:  act.depSource  ?? null,
                    arrSource:  act.arrSource  ?? null,
                    now,
                  });
                  const lateSeg  = segs.find(s => s.kind === 'late');
                  const earlySeg = segs.find(s => s.kind === 'early');
                  if (lateSeg) {
                    const mins = Math.round(Math.abs(lateSeg.to - lateSeg.from) / 60000);
                    badge = { text: `+${mins} late`, bg: 'rgba(245,158,11,0.13)', border: 'rgba(245,158,11,0.35)', color: 'var(--warning)' };
                  } else if (earlySeg) {
                    const mins = Math.round(Math.abs(earlySeg.to - earlySeg.from) / 60000);
                    badge = { text: `-${mins} early`, bg: `${STATE_COLORS.inflight}22`, border: `${STATE_COLORS.inflight}44`, color: STATE_COLORS.inflight };
                  }
                } catch (_) {}
              }

              // Meta line
              const duration = formatDuration(leg._calc?._minutes);
              const pax      = leg.passengers?.length ?? 0;
              const pic      = leg.pilots?.find(p => p.seat === 2)?.user?.lastName;
              const sic      = leg.pilots?.find(p => p.seat === 3)?.user?.lastName;
              const crewParts = [];
              if (pic) crewParts.push(`PIC ${pic}`);
              if (sic) crewParts.push(`SIC ${sic}`);
              const crewLine = crewParts.length > 0 ? crewParts.join(' · ') : null;

              return (
                <div
                  key={legId || li}
                  onClick={() => onOpenLeg(leg)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onOpenLeg(leg)}
                  style={{
                    display: 'flex',
                    background: 'var(--bg-card)',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    minHeight: 60,
                    userSelect: 'none',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  {/* Status-colour left edge */}
                  <div style={{ width: 3, minWidth: 3, background: color, flexShrink: 0 }} />

                  {/* Card body */}
                  <div style={{ flex: 1, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                    {/* Row 1: route + tail + badge */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{
                        fontSize: '15px',
                        fontWeight: '700',
                        color: diverted ? 'var(--danger)' : 'var(--text-primary)',
                        flexShrink: 0,
                      }}>
                        {routeText}
                      </span>
                      <span style={{ fontSize: '12px', color: 'var(--accent)', fontWeight: '600', flexShrink: 0 }}>
                        {tail}
                      </span>
                      <div style={{ flex: 1 }} />
                      {badge && (
                        <span style={{
                          fontSize: '11px',
                          fontWeight: '700',
                          color: badge.color,
                          background: badge.bg,
                          padding: '2px 7px',
                          borderRadius: 4,
                          border: `1px solid ${badge.border}`,
                          flexShrink: 0,
                          whiteSpace: 'nowrap',
                        }}>
                          {badge.text}
                        </span>
                      )}
                    </div>

                    {/* Row 2: Eastern times (primary) */}
                    <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                      {depTimeEt} → {arrTimeEt}{' '}
                      <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
                        {depEt?.zone || 'ET'}
                      </span>
                    </div>

                    {/* Row 3: UTC times (secondary / muted) */}
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {depTimeZ} → {arrTimeZ} UTC
                    </div>

                    {/* Row 4: duration · pax · crew */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 1 }}>
                      {duration && (
                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{duration}</span>
                      )}
                      <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{pax} pax</span>
                      {crewLine && (
                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{crewLine}</span>
                      )}
                    </div>
                  </div>

                  {/* Chevron */}
                  <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px', color: 'var(--text-secondary)', flexShrink: 0, fontSize: '18px', lineHeight: 1 }}>
                    ›
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
