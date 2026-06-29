// frontend/src/lib/calendarLeg.js
// Pure helpers shared between the Gantt (Calendar.jsx) and the phone agenda
// (CalendarAgenda.jsx). No React imports — this module is safe to use in
// node:test without a DOM.

export const STATUS = {
  0: { label: 'Scheduled' },
  1: { label: 'Active' },
  2: { label: 'Booked' },
  3: { label: 'Completed' },
};

// Block colour by flight STATE (uses actuals when known): completed/landed = blue,
// in-flight = green, future/not-yet-departed = grey.
export const STATE_COLORS = { completed: '#4f8ef7', inflight: '#22c55e', future: '#64748b' };

// Whether to TRUST/show an actual arrival: present, and not before a known departure
// (arr <= dep = corrupt → ignore). An arrival with NO recorded departure is still valid
// — ADS-B routinely misses the wheels-up — so a flight that lands without a captured
// takeoff still renders (scheduled departure as the bar start) instead of vanishing on
// landing. (The backend matcher's coherentArrival stays stricter on purpose.)
export const arrShown = (dep, arr) => arr != null && (dep == null || arr > dep);

export function legStateColor(leg, isAirborne, act, now) {
  const dep = leg?.departure?.time, arr = leg?.arrival?.time;
  const aDep = act?.actualDep ?? null;
  const aArr = arrShown(act?.actualDep, act?.actualArr) ? act.actualArr : null; // ignore only corrupt arrivals (arr<=dep)
  if (isAirborne) return STATE_COLORS.inflight;                                   // ADS-B says airborne
  if (aArr != null) return aArr <= now ? STATE_COLORS.completed : STATE_COLORS.inflight; // truly landed
  if (aDep != null) {
    // Departed but no coherent arrival: in-flight, never "complete" on a corrupt
    // arrival. Assume landed only well past schedule (ADS-B missed the arrival).
    return (arr != null && now > arr + 3 * 3600000) ? STATE_COLORS.completed : STATE_COLORS.inflight;
  }
  // No actual departure recorded → fall back to the schedule clock.
  if (dep != null && dep > now) return STATE_COLORS.future;                       // not yet departed
  if (dep != null && arr != null && dep <= now && now < arr) return STATE_COLORS.inflight; // mid-flight by clock
  if (arr != null && arr <= now) return STATE_COLORS.completed;
  return STATE_COLORS.future;
}

export const floorDay = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
