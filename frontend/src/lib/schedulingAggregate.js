// frontend/src/lib/schedulingAggregate.js
// Pure rollups derived from the scheduling legs payload (each leg is an LF-shaped
// snapshot from /api/scheduling/legs). No I/O — feed it the `legs` array. These
// back the Overview / Crew / Aircraft / Clients screens.

const tripKey = (l) => l?.dispatch?._id?.$oid || null;
const ms = (t) => (typeof t === 'number' ? t : (t ? Date.parse(t) : null));

// Crew role from cockpit seat: 2 = PIC, 3 = SIC, anything else = cabin.
export function crewRole(seat) {
  if (seat === 2) return 'PIC';
  if (seat === 3) return 'SIC';
  return 'Cabin';
}

export function distinctAircraft(legs = []) {
  const map = new Map();
  for (const l of legs) {
    const ac = l?.dispatch?.aircraft;
    const tail = ac?.tailNumber;
    if (!tail) continue;
    if (!map.has(tail)) map.set(tail, { tail, type: ac.type?.name || null, paxSeats: ac.paxSeats ?? null, legCount: 0, trips: new Set() });
    const e = map.get(tail);
    e.legCount += 1;
    if (tripKey(l)) e.trips.add(tripKey(l));
  }
  return [...map.values()]
    .map((e) => ({ tail: e.tail, type: e.type, paxSeats: e.paxSeats, legCount: e.legCount, tripCount: e.trips.size }))
    .sort((a, b) => a.tail.localeCompare(b.tail));
}

export function distinctClients(legs = []) {
  const map = new Map();
  for (const l of legs) {
    const name = l?.dispatch?.client?.company?.name;
    if (!name) continue;
    if (!map.has(name)) map.set(name, { name, wholesale: !!l.dispatch.client.company.wholesale, legCount: 0, trips: new Set() });
    const e = map.get(name);
    e.legCount += 1;
    if (tripKey(l)) e.trips.add(tripKey(l));
  }
  return [...map.values()]
    .map((e) => ({ name: e.name, wholesale: e.wholesale, legCount: e.legCount, tripCount: e.trips.size }))
    .sort((a, b) => b.tripCount - a.tripCount || a.name.localeCompare(b.name));
}

export function distinctCrew(legs = []) {
  const map = new Map();
  for (const l of legs) {
    for (const c of [...(l?.pilots || []), ...(l?.attendants || [])]) {
      const u = c?.user;
      if (!u) continue;
      const id = u._id?.$oid || `${u.firstName || ''} ${u.lastName || ''}`.trim();
      const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || 'Unknown';
      if (!map.has(id)) map.set(id, { id, name, title: u.title || null, seats: new Set(), legCount: 0, trips: new Set() });
      const e = map.get(id);
      e.legCount += 1;
      e.seats.add(c.seat);
      if (tripKey(l)) e.trips.add(tripKey(l));
    }
  }
  return [...map.values()]
    .map((e) => ({ name: e.name, title: e.title, role: crewRole(Math.min(...e.seats)), legCount: e.legCount, tripCount: e.trips.size }))
    .sort((a, b) => b.legCount - a.legCount || a.name.localeCompare(b.name));
}

export function overviewStats(legs = [], now = Date.now()) {
  const trips = new Set();
  for (const l of legs) { const k = tripKey(l); if (k) trips.add(k); }
  const dayMs = 86400000;
  const dep = (l) => ms(l?.departure?.time);
  const flightsToday = legs.filter((l) => { const t = dep(l); return t != null && t >= now && t < now + dayMs; }).length;
  const flightsWeek = legs.filter((l) => { const t = dep(l); return t != null && t >= now && t < now + 7 * dayMs; }).length;
  const upcoming = legs
    .filter((l) => { const t = dep(l); return t != null && t >= now; })
    .sort((a, b) => dep(a) - dep(b))
    .slice(0, 6);
  return {
    tripCount: trips.size,
    legCount: legs.length,
    aircraftCount: distinctAircraft(legs).length,
    clientCount: distinctClients(legs).length,
    crewCount: distinctCrew(legs).length,
    flightsToday,
    flightsWeek,
    upcoming,
  };
}
