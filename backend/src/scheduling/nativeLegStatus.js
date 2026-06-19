// backend/src/scheduling/nativeLegStatus.js
//
// Keep NATIVE legs' display snapshot status in sync with their trip's working
// status, so the lists / board reflect status changes (Book, Cancel, auto-close).
// Native snapshots are display-only (not a revert source), so this is safe — and
// it self-filters to origin='native', so it never touches a mirrored trip's LF
// snapshot.
import { supabase } from '../services/supabase.js';

export async function syncNativeLegStatus(tripId, status) {
  const { data: legRows, error } = await supabase
    .from('scheduling_legs').select('id, lf_synced_snapshot').eq('trip_id', tripId).eq('origin', 'native');
  if (error) throw error;
  for (const lr of legRows || []) {
    const snap = lr.lf_synced_snapshot;
    if (!snap) continue;
    snap.status = status;
    if (snap.dispatch) snap.dispatch.status = status;
    const { error: ue } = await supabase
      .from('scheduling_legs').update({ lf_synced_snapshot: snap }).eq('id', lr.id);
    if (ue) throw ue;
  }
}
