// backend/src/fleet/componentAccrual.js
// Pure: a completed flight_info + an aircraft's components -> ledger entry rows.

function minutesBetween(a, b) {
  if (!a || !b) return null;
  const t0 = new Date(a).getTime(); const t1 = new Date(b).getTime();
  if (Number.isNaN(t0) || Number.isNaN(t1)) return null;
  return Math.round((t1 - t0) / 60000);
}
const num = (v) => (v == null || v === '' ? null : Number(v));

// Returns array of { component_id, source, leg_id, hours_delta, cycles_delta, time_source }
export function computeLegEntries(fi, components) {
  if (!fi || fi.status !== 'complete') return [];
  const legId = fi.scheduling_leg_id;
  const when = fi.completed_at || fi.on_at || fi.in_at;
  const flightMin = minutesBetween(fi.off_at, fi.on_at);
  const rows = [];
  for (const c of components || []) {
    if (c.active === false) continue;
    // baseline-date filter: only accrue legs that completed after this component's baseline
    if (c.baseline_at && when && new Date(when).getTime() <= new Date(c.baseline_at).getTime()) continue;

    if (c.component_type === 'apu' || c.accrues_flight_time === false) {
      const hrs = (num(fi.apu_stop) != null && num(fi.apu_start) != null)
        ? num(fi.apu_stop) - num(fi.apu_start) : null;
      const reading = num(fi.apu_end_cycles);
      const cyc = (reading != null && c.apu_last_reading != null) ? reading - c.apu_last_reading : 0;
      if (hrs == null && !cyc) continue;
      rows.push({
        component_id: c.id, source: 'flight_info', leg_id: legId,
        hours_delta: hrs ?? 0, cycles_delta: cyc || 0, time_source: 'crew',
      });
    } else {
      if (flightMin == null) continue;
      rows.push({
        component_id: c.id, source: 'flight_info', leg_id: legId,
        hours_delta: flightMin / 60,
        cycles_delta: c.tracks_cycles === false ? 0 : 1,
        time_source: 'crew',
      });
    }
  }
  return rows;
}
