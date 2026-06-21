// backend/src/services/itineraryData.js
// Builds the passenger-itinerary view-model from getTripLog (operational dispatches
// carry FULL legs: crew, FBO, coords). Pure mappers (mapItineraryLeg, mapClient) are
// unit-tested; the I/O (getTripLog, weather) lives in buildItinerary.
import { getTripLog } from './levelflight.js';
import { getDailyForecast } from './weather.js';
import { assignedPaxCount } from './paxCount.js';
import { leadUserId } from './leadPassenger.js';

const fullName = (u) => (u ? [u.firstName, u.lastName].filter(Boolean).join(' ') : '') || null;
const oid = (x) => x?.$oid || x;
const loc = (x) => (x && x.lat != null && x.lng != null ? [x.lat, x.lng] : null);

// Passenger names for a leg, LEAD FIRST (lead = the LevelFlight lead-toggle passenger,
// identified by their unique forward seat — see leadPassenger.js). No clear standout
// -> no lead, original order kept.
function mapLegPassengers(list) {
  const leadId = leadUserId(list);
  return (list || [])
    .map((p) => ({ name: fullName(p?.user), lead: leadId != null && oid(p?.user?._id) === leadId }))
    .filter((p) => p.name)
    .sort((a, b) => Number(b.lead) - Number(a.lead)); // lead first; others keep order (stable)
}

function mapFbo(node) {
  const f = node?.fbo;
  if (!f) return null;
  const a = f.address || {};
  const address = [a.street, a.city, a.state, a.postalCode].filter(Boolean).join(', ');
  return { name: f.name || null, address: address || null, phone: f.phones?.[0] || null };
}

function mapCrew(leg) {
  const pilots = leg?.pilots || [];
  const pic = fullName(pilots.find((p) => p.seat === 2)?.user) || fullName(pilots[0]?.user);
  const sic = fullName(pilots.find((p) => p.seat === 3)?.user) || fullName(pilots[1]?.user);
  const ca = (leg?.attendants || []).map((a) => fullName(a.user)).filter(Boolean);
  return { pic: pic || null, sic: sic || null, ca };
}

export function mapItineraryLeg(l) {
  return {
    from: l?.departure?.airport ?? null,
    to: l?.arrival?.airport ?? null,
    fromName: l?._calc?.from?.name ?? null,
    toName: l?._calc?.to?.name ?? null,
    depTime: l?.departure?.time ?? null,
    arrTime: l?.arrival?.time ?? null,
    distance: l?._calc?.distance?.value ?? null,
    eft: l?._calc?.time ?? null,
    pax: assignedPaxCount(l), // assigned passengers, not LF's passengerCount field
    passengers: mapLegPassengers(l?.passengers), // [{ name, lead }], lead first
    fromLatLng: loc(l?._calc?.from?.location),
    toLatLng: loc(l?._calc?.to?.location),
    depFbo: mapFbo(l?.departure),
    arrFbo: mapFbo(l?.arrival),
    crew: mapCrew(l),
  };
}

export function mapClient(dispatch) {
  const c = dispatch?.client || {};
  const cust = c.customer || {};
  const comp = c.company || {};
  const a = comp.address || {};
  const address = [a.street, a.city, a.postalCode, a.country].filter(Boolean).join(', ');
  const name = cust._fullName || [cust.firstName, cust.lastName].filter(Boolean).join(' ');
  return { name: name || null, company: comp.name || null, address: address || null };
}

export async function buildItinerary(dispatchId) {
  const tl = await getTripLog(dispatchId);
  const dispatch = tl?.dispatch;
  if (!dispatch) return null;
  const ac = tl?.aircraft || dispatch?.aircraft || {};
  // Passenger itinerary: only show legs the passengers are actually on — hide empty
  // positioning/ferry legs. (Keep all only if none carry pax, so it's never blank.)
  const allLegs = (dispatch.legs || []).map(mapItineraryLeg);
  const withPax = allLegs.filter((l) => (l.pax || 0) > 0);
  const legs = withPax.length ? withPax : allLegs;

  // Unique airports (with coords) across all legs -> one forecast each.
  const airports = new Map();
  for (const l of legs) {
    if (l.from && l.fromLatLng) airports.set(l.from, { code: l.from, name: l.fromName, ll: l.fromLatLng });
    if (l.to && l.toLatLng) airports.set(l.to, { code: l.to, name: l.toName, ll: l.toLatLng });
  }
  const weather = [];
  for (const a of airports.values()) {
    const forecast = await getDailyForecast(a.ll[0], a.ll[1]);
    if (forecast.length) weather.push({ code: a.code, name: a.name, forecast });
  }

  return {
    dispatchId,
    tripNumber: dispatch.tripId != null ? String(dispatch.tripId) : null,
    quoteNumber: dispatch.quoteId != null ? String(dispatch.quoteId) : null,
    tail: ac?.tailNumber ?? null,
    aircraftType: ac?.type?.name ?? null,
    maxPax: ac?.paxSeats ?? null,
    client: mapClient(dispatch),
    legs,
    weather,
    preparedOn: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
  };
}
