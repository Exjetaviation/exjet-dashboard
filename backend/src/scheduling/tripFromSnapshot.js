// backend/src/scheduling/tripFromSnapshot.js
//
// Pure: rebuild a trip's working-copy columns from its LevelFlight dispatch
// snapshot. Used by Revert to restore a locally-edited trip to LevelFlight's
// version. Field paths mirror the mapper in mapScheduledLegs.js.
import { oidToStr } from './lfNormalize.js';

export function tripColumnsFromSnapshot(snapshot) {
  const d = snapshot || {};
  return {
    status: d.status ?? null,
    trip_number: d.tripId != null ? String(d.tripId) : null,
    aircraft_lf_oid: oidToStr(d?.aircraft?._id?.$oid) || oidToStr(d?.aircraft?._id) || null,
    company_lf_oid: oidToStr(d?.client?.company?._id?.$oid) || oidToStr(d?.client?.company?._id) || null,
    customer_lf_oid: oidToStr(d?.client?.customer?._id?.$oid) || oidToStr(d?.client?.customer?._id) || null,
  };
}
