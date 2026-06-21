// backend/src/services/paxCount.js
//
// Count the passengers actually ASSIGNED to a LevelFlight leg — the `passengers`
// {user,seat} list. LF's `passengerCount` field can disagree (e.g. 15 vs 13
// actually assigned), so it's only a fallback when no assigned list is present.
// One rule, used by the itinerary, the scheduling mirror, and the dashboard legs.
export function assignedPaxCount(leg) {
  return Array.isArray(leg?.passengers) ? leg.passengers.length : (leg?.passengerCount ?? null);
}
