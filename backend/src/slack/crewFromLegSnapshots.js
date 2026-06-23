// backend/src/slack/crewFromLegSnapshots.js
//
// Extract a trip's crew (pilots + attendants) from its leg snapshots.
// Returns deduped [{ oid, role, name, email }]. Seats: 2=PIC, 3=SIC, 7=FA.
import { oidToStr } from '../scheduling/lfNormalize.js';

const roleForSeat = (seat) => (seat === 2 ? 'PIC' : seat === 3 ? 'SIC' : seat === 7 ? 'FA' : 'crew');

export function crewFromLegSnapshots(legSnapshots = []) {
  const byOid = new Map();
  for (const snap of legSnapshots || []) {
    const members = [
      ...(Array.isArray(snap?.pilots) ? snap.pilots : []),
      ...(Array.isArray(snap?.attendants) ? snap.attendants : []),
    ];
    for (const m of members) {
      const u = m?.user || m;
      const oid = oidToStr(u?._id?.$oid) || oidToStr(u?._id) || oidToStr(u?.oid) || oidToStr(u?.id);
      if (!oid || byOid.has(oid)) continue;
      const name = [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || u?.name || null;
      byOid.set(oid, { oid, role: roleForSeat(m?.seat), name, email: u?.email || null });
    }
  }
  return [...byOid.values()];
}
