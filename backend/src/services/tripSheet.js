// backend/src/services/tripSheet.js
// Builds the crew Trip Sheet (Flight Release) view-model from LevelFlight's /release
// JSON. ALL data fetching + mapping stays in the backend; the renderer turns the VM
// into branded HTML and the routes return HTML/PDF (the frontend never sees JSON).
// Pure mappers (mapReleaseLeg, mapManifest, mapMaintenance) are unit-tested; the I/O
// (getDispatchRelease) lives in buildCrewTripSheet.
import { getDispatchRelease } from './levelflight.js';

const oid = (v) => (v && typeof v === 'object' ? v.$oid : v) || null;
const fullName = (u) => (u ? [u.firstName, u.lastName].filter((s) => String(s || '').trim()).join(' ').trim() : '') || null;
const loc = (x) => (x && x.lat != null && x.lng != null ? [x.lat, x.lng] : null);
const trimComms = (c) => {
  if (!c) return null;
  const out = {};
  for (const k of ['TWR', 'GND', 'UNICOM', 'CLRDEL1', 'ATIS']) if (c[k] != null && String(c[k]).trim()) out[k] = String(c[k]).trim();
  return Object.keys(out).length ? out : null;
};
const fmtAddr = (a) => (a ? [a.street, a.city, a.state, a.postalCode].filter(Boolean).join(', ') : '') || null;

// LevelFlight purpose ids that are non-revenue Part 91 ops (from /api/leg/purposes).
// Anything else (incl. the implicit/default charter purpose) is a Part 135 charter.
const PURPOSE_91 = { 4: 'Positioning', 5: 'Maintenance', 6: 'Training', 8: 'Owner', 9: 'Company', 11: 'Owner Lease', 12: 'Owner Fractional' };
export function flightType(purpose) {
  const name = PURPOSE_91[purpose];
  return name ? { part: 91, label: `Part 91 · ${name}` } : { part: 135, label: '135 · Charter' };
}

// Resolve a leg's flight type. Owner/Part-91 trips often tag the legs with the
// implicit charter purpose (7, not in the enum) while the OWNER classification
// lives on the dispatch. So: use the leg purpose when it's a known Part-91 type,
// otherwise inherit the dispatch purpose. This keeps owner flights from showing
// as 135 Charter.
export function legFlightType(r) {
  const legP = r?.purpose;
  const dispP = r?.dispatch?.purpose;
  return flightType(PURPOSE_91[legP] ? legP : (dispP ?? legP));
}

function mapFbo(node) {
  const f = node?.fbo;
  if (!f) return null;
  return {
    name: f.name || null,
    address: fmtAddr(f.address),
    phones: Array.isArray(f.phones) ? f.phones.filter(Boolean) : [],
    arinc: f.comms?.arinc || f.comms?.ARINC || null,
    atg: f.comms?.atg || f.comms?.ATG || null,
    crewNote: f.crewNote || null,
  };
}

// employee directory: _id -> { dob, phone } for joining crew detail onto leg pilots.
export function indexEmployees(employees = []) {
  const m = new Map();
  for (const e of employees) {
    const id = oid(e?._id);
    if (id) m.set(id, { dob: e.birthday ?? null, phone: (e.phones || []).filter(Boolean)[0] || null });
  }
  return m;
}

function crewMember(entry, empById) {
  if (!entry?.user) return null;
  const detail = empById.get(oid(entry.user._id)) || {};
  return { name: fullName(entry.user), dob: detail.dob ?? null, phone: detail.phone ?? null };
}

export function mapReleaseLeg(r, empById = new Map(), paxById = new Map(), tripManifest = []) {
  const pilots = r?.pilots || [];
  const paxCount = r?.passengerCount ?? (r?.passengers || []).length ?? null;
  // Per-leg passenger manifest: the leg lists who's aboard (by user id); join to the
  // trip-level pax details. LevelFlight only populates the explicit list on some legs,
  // so a leg that carries passengers (paxCount > 0) but no explicit list falls back to
  // the full trip manifest — otherwise that leg would show no passengers at all.
  let legManifest = Array.isArray(r?.passengers)
    ? r.passengers.map((pp) => paxById.get(oid(pp?.user?._id)) || (pp?.user ? { name: fullName(pp.user) } : null)).filter(Boolean)
    : null;
  if ((!legManifest || !legManifest.length) && paxCount > 0) legManifest = tripManifest;
  const ca = (r?.attendants || []).map((a) => crewMember(a, empById)).filter(Boolean);
  return {
    callSign: r?.callSign || null,
    flightType: legFlightType(r),
    from: r?.departure?.airport ?? null,
    to: r?.arrival?.airport ?? null,
    fromName: r?._calc?.from?.name ?? null,
    toName: r?._calc?.to?.name ?? null,
    fromElev: r?._calc?.from?.elevation ?? null,
    toElev: r?._calc?.to?.elevation ?? null,
    depTime: r?.departure?.time ?? null,
    arrTime: r?.arrival?.time ?? null,
    depTz: r?._calc?.from?.timezone ?? null,
    arrTz: r?._calc?.to?.timezone ?? null,
    distance: r?._calc?.distance?.value ?? null,
    minutes: r?._calc?.minutes ?? null,
    eft: r?._calc?.time ?? null,
    fuelBurn: r?._calc?.fuel?.value ?? null,
    fromLatLng: loc(r?._calc?.from?.location),
    toLatLng: loc(r?._calc?.to?.location),
    depComms: trimComms(r?._calc?.from?.comms),
    arrComms: trimComms(r?._calc?.to?.comms),
    depMetar: r?.weather?.departure?.raw || null,
    arrMetar: r?.weather?.arrival?.raw || null,
    depFbo: mapFbo(r?.departure),
    arrFbo: mapFbo(r?.arrival),
    pax: paxCount,
    manifest: legManifest,
    crew: {
      pic: crewMember(pilots.find((p) => p.seat === 2) || pilots[0], empById),
      sic: crewMember(pilots.find((p) => p.seat === 3) || pilots[1], empById),
      ca,
    },
    releasedBy: r?.releasedBy?.userName || null,
    releasedAt: r?.releasedBy?.timestamp ?? null,
    crewNote: r?.crewNote || null,
  };
}

function paxRow(p) {
  const doc = (p.documents || [])[0];
  return {
    name: p._fullName || fullName(p),
    gender: p.gender || null,
    weight: p.weight ?? null,
    dob: p.birthday ?? null,
    citizenship: p.citizenship || null,
    passport: doc ? [doc.number, doc.country].filter(Boolean).join(' - ') : null,
  };
}
export function mapManifest(pax = []) {
  return pax.map(paxRow);
}

export function mapMaintenance(d) {
  const ac = d?.aircraft || {};
  const camp = ac._camp || {};
  const eng = ac.components?.engines || {};
  const engines = Object.keys(eng).sort().map((k) => ({ pos: k, model: (eng[k].model || '').trim() || null, serial: eng[k].serial || null }));
  const apu = ac.components?.apu ? { model: (ac.components.apu.model || '').trim() || null, serial: ac.components.apu.serial || null } : null;
  const upcoming = (d?.mx || [])
    .filter((m) => m?.hours?.remaining != null)
    .sort((a, b) => a.hours.remaining - b.hours.remaining)
    .slice(0, 12)
    .map((m) => ({ name: m.name || m.code || null, due: m.hours.due ?? null, remaining: Math.round(m.hours.remaining) }));
  const closed = (d?.closedEvents || []).map((e) => ({ title: e.title || e.description || null, date: e.eventDate ?? e.closedOn ?? null, id: e.id ?? null }));
  return {
    airframe: { type: ac.type?.name || null, serial: ac.serial || null, hours: camp.hours ?? null, landings: camp.landings ?? null, reported: camp.reported ?? null },
    engines,
    apu,
    upcoming,
    closed,
  };
}

export async function buildCrewTripSheet(dispatchId, deps = {}) {
  const get = deps.get || getDispatchRelease;
  let d;
  try { d = await get(dispatchId); } catch { return null; }
  if (!d || !Array.isArray(d.releases) || !d.releases.length) return null;

  const empById = indexEmployees(d.employees);
  const paxById = new Map();
  for (const p of d.pax || []) { const k = oid(p?._id); if (k) paxById.set(k, paxRow(p)); }
  const tripManifest = mapManifest(d.pax);
  const legs = d.releases.map((r) => mapReleaseLeg(r, empById, paxById, tripManifest));
  const disp = d.releases[0]?.dispatch || {};
  const cust = disp.client?.customer;
  const totalDist = legs.reduce((s, l) => s + (l.distance || 0), 0);
  const totalMin = legs.reduce((s, l) => s + (l.minutes || 0), 0);

  return {
    dispatchId,
    tripNumber: disp.tripId != null ? String(disp.tripId) : null,
    quoteNumber: disp.quoteId != null ? String(disp.quoteId) : null,
    routeSummary: disp._internal?.summary || legs.map((l) => l.from).concat(legs.length ? legs[legs.length - 1].to : []).filter(Boolean).join(', ') || null,
    operator: { name: d.operation?.name || 'EXJET AVIATION', address: fmtAddr(d.operation?.address), cert: d.operation?.cert?.number || null, part: d.operation?.part ?? null },
    client: {
      name: cust ? (cust._fullName || fullName(cust)) : null,
      company: d.company?.name || disp.client?.company?.name || null,
      address: fmtAddr(d.company?.address || disp.client?.company?.address),
    },
    aircraft: { tail: d.aircraft?.tailNumber || null, type: d.aircraft?.type?.name || null, serial: d.aircraft?.serial || null, maxPax: d.aircraft?.paxSeats ?? null, year: d.aircraft?.year ?? null },
    totals: { legs: legs.length, distance: totalDist || null, minutes: totalMin || null },
    tsa: disp.tsa ?? null,
    legs,
    manifest: mapManifest(d.pax),
    maintenance: mapMaintenance(d),
    preparedOn: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  };
}
