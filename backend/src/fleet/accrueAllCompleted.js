// backend/src/fleet/accrueAllCompleted.js
import { supabase } from '../services/supabase.js';
import { getAircraft } from './aircraftStore.js';
import { listComponents, applyLedgerEntry } from './componentStore.js';
import { accrueLeg } from './accrueLeg.js';

export async function accrueAllCompleted() {
  if (!supabase) return 0;
  const { data: rows, error } = await supabase
    .from('flight_info')
    .select('*, scheduling_legs(lf_synced_snapshot, dep_icao)')
    .eq('status', 'complete');
  if (error || !rows) return 0;
  const deps = {
    getAircraftByTail: (t) => getAircraft(supabase, t),
    listComponents: (acId) => listComponents(supabase, acId),
    applyLedgerEntry: (e) => applyLedgerEntry(supabase, e),
  };
  let total = 0;
  for (const fi of rows) {
    const tail = fi.scheduling_legs?.lf_synced_snapshot?.dispatch?.aircraft?.tailNumber;
    if (tail) total += await accrueLeg(deps, fi, tail);
  }
  return total;
}
