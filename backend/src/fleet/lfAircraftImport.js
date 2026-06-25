// backend/src/fleet/lfAircraftImport.js
// Orchestrates: fetch LF -> map -> upsert. All I/O injected for testability.
import { mapLfAircraft, mapLfComponents } from './lfAircraftMap.js';

// deps: { fetchList, fetchDetail, fetchTimes, getExistingByTail, upsertAircraft, upsertComponent }
export async function importFleet(deps) {
  const list = await deps.fetchList();
  let times = null;
  try { times = await deps.fetchTimes(); } catch { times = null; }
  let aircraftCount = 0, componentCount = 0;

  for (const summary of list || []) {
    const id = summary?._id?.$oid || summary?._id || summary?.id;
    if (!id) continue;
    const detail = await deps.fetchDetail(id);
    const mapped = mapLfAircraft(detail || summary);
    if (!mapped?.tail) continue;

    const existing = await deps.getExistingByTail(mapped.tail);
    let row;
    if (existing?.locally_modified) {
      row = { tail: mapped.tail, lf_aircraft_oid: mapped.lf_aircraft_oid, origin: 'levelflight',
              locally_modified: true, lf_synced_snapshot: mapped.lf_synced_snapshot,
              synced_at: new Date().toISOString() };
    } else {
      row = { ...mapped, synced_at: new Date().toISOString() };
    }
    const saved = await deps.upsertAircraft(row);
    aircraftCount += 1;

    const comps = mapLfComponents(detail || summary);
    for (const c of comps) {
      const seeded = applyBaselineTimes(c, mapped.tail, times);
      await deps.upsertComponent({ ...seeded, aircraft_id: saved.id });
      componentCount += 1;
    }
  }
  return { aircraft: aircraftCount, components: componentCount };
}

// Overlay per-component baseline hours/cycles from the otherFlightTimes payload when present.
// Tolerates unknown shape: looks up by tail + position/serial; leaves mapper defaults otherwise.
function applyBaselineTimes(comp, tail, times) {
  if (!times) return comp;
  const byTail = times[tail] || times[tail?.toUpperCase()] || null;
  if (!byTail) return comp;
  const rec = byTail[comp.position] || byTail[comp.serial] || null;
  if (!rec) return comp;
  return {
    ...comp,
    baseline_hours: rec.hours != null ? Number(rec.hours) : comp.baseline_hours,
    baseline_cycles: rec.cycles != null ? Number(rec.cycles) : comp.baseline_cycles,
    apu_last_reading: comp.component_type === 'apu' && rec.cycles != null ? Number(rec.cycles) : comp.apu_last_reading,
  };
}
