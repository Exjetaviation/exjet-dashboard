// backend/src/services/leadPassenger.js
// Identifies the LEAD passenger on a leg, shared by the itinerary and the trip sheet.
//
// LevelFlight has no explicit "lead" field in its API (flightLog/release/scheduledLegs
// all return passengers as just { user, seat }). The lead-passenger toggle in the LF UI
// manifests in the DATA as the SEAT: the lead is assigned a forward (unique lowest) seat
// while everyone else shares a default seat (e.g. lead=seat 8, others=seat 9). So the
// lead is the single passenger holding the unique minimum seat. If there's no clear
// standout — all the same seat, none seated, or a tie for lowest — there's no lead.
const oid = (x) => x?.$oid || x;

export function leadUserId(passengers) {
  const seated = (passengers || []).filter((p) => p?.seat != null && p?.user?._id != null);
  if (!seated.length) return null;
  const min = Math.min(...seated.map((p) => p.seat));
  const atMin = seated.filter((p) => p.seat === min);
  return atMin.length === 1 ? oid(atMin[0].user._id) : null;
}
