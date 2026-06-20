// backend/src/scheduling/crewAssignment.js
//
// Turn a per-trip crew assignment (PIC / SIC / Flight Attendant) into the
// LevelFlight-shaped pilots/attendants arrays stored on each leg snapshot, so the
// assigned crew shows up in the Crew list, itinerary, and trip sheet. Seats follow
// LevelFlight: 2 = PIC, 3 = SIC, 7 = cabin/flight attendant.
const member = (m, seat) => {
  if (!m) return null;
  const firstName = (m.firstName || '').trim() || null;
  const lastName = (m.lastName || '').trim() || null;
  if (!firstName && !lastName && !m.name) return null;
  return {
    seat,
    user: {
      _id: m._id || (m.id ? { $oid: String(m.id) } : null),
      firstName, lastName,
      title: m.title || null,
      email: m.email || null,
    },
  };
};

// assignment: { pic, sic, fa } — each a roster entry (or null).
// Returns { pilots: [...], attendants: [...] } for a leg snapshot.
export function buildCrewArrays(assignment = {}) {
  const pilots = [member(assignment.pic, 2), member(assignment.sic, 3)].filter(Boolean);
  const attendants = [member(assignment.fa, 7)].filter(Boolean);
  return { pilots, attendants };
}

// Read a per-trip assignment back out of a leg snapshot (for the editor's current
// values). Returns { pic, sic, fa } where each is the user object or null.
export function readCrewFromSnapshot(snapshot = {}) {
  const pilots = snapshot.pilots || [];
  const attendants = snapshot.attendants || [];
  const find = (list, seat) => list.find((c) => c.seat === seat)?.user || null;
  return {
    pic: find(pilots, 2),
    sic: find(pilots, 3),
    fa: find(attendants, 7) || (attendants[0]?.user ?? null),
  };
}
