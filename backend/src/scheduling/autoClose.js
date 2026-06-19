// backend/src/scheduling/autoClose.js
//
// Close out released trips whose flight is complete (every leg has arrived).
// Runs on the sync worker tick so closure is automatic, not view-dependent.
// Arrival times are read from each leg's snapshot, so this works for both native
// and mirrored legs.
import { supabase } from '../services/supabase.js';
import { shouldAutoClose } from './workflow.js';
import { syncNativeLegStatus } from './nativeLegStatus.js';

export async function autoCloseCompletedTrips(now) {
  const { data: trips, error } = await supabase
    .from('scheduling_trips').select('id').eq('status', 'released');
  if (error) throw error;

  let closed = 0;
  for (const t of trips || []) {
    const { data: legs, error: le } = await supabase
      .from('scheduling_legs').select('lf_synced_snapshot').eq('trip_id', t.id);
    if (le) throw le;
    const arrMs = (legs || []).map((l) => l.lf_synced_snapshot?.arrival?.time ?? null);
    if (shouldAutoClose('released', arrMs, now)) {
      const { error: ue } = await supabase
        .from('scheduling_trips').update({ status: 'closed', modified_at: now }).eq('id', t.id);
      if (ue) throw ue;
      await syncNativeLegStatus(t.id, 'closed');
      closed += 1;
    }
  }
  return closed;
}
