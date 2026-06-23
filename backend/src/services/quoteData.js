// Shared quote view-model builder (used by the authed dashboard routes and the
// public client routes). The per-dispatch flightLog returns FULL legs (airports,
// times, distance, EFT, inline _calc.from/to.location coords).
import { getTripLog } from './levelflight.js';
import { mapLegDetail, quoteTotal } from './quoteMap.js';

export const ACCEPT_BASE = 'https://api.levelflight.com/client';

export async function buildViewModel(dispatchId) {
  const tl = await getTripLog(dispatchId);
  const dispatch = tl?.dispatch;
  if (!dispatch) return null;
  const ac = tl?.aircraft || dispatch?.aircraft || {};
  const internal = dispatch?._internal || {};
  // Show only revenue legs (passengers on board), like the LevelFlight quote —
  // hide empty positioning/ferry legs (passengerCount 0). Fall back to all legs
  // if none are flagged, so a data gap never yields a blank itinerary.
  const allLegs = dispatch?.legs || [];
  const paxLegs = allLegs.filter((l) => Number(l?.passengerCount) > 0);
  const legs = (paxLegs.length ? paxLegs : allLegs).map(mapLegDetail);
  return {
    dispatchId,
    quoteNumber: dispatch?.quoteId != null ? String(dispatch.quoteId) : null,
    tail: ac?.tailNumber ?? null,
    aircraftType: ac?.type?.name ?? null,
    maxPax: ac?.paxSeats ?? null,
    total: quoteTotal(internal?.price),
    amenities: ['Flight Attendant', 'WIFI'],
    preparedOn: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    acceptUrl: `${ACCEPT_BASE}/${dispatchId}/accept`,
    legs,
  };
}
