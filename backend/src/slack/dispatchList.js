// backend/src/slack/dispatchList.js
//
// Normalize getDispatchList() (POST /api/dispatch/list) into [{ oid, tripId }].
// The LF response shape is undocumented, so use field-path fallbacks.
import { oidToStr } from '../scheduling/lfNormalize.js';

export function normalizeDispatchList(raw) {
  const rows = Array.isArray(raw) ? raw : (raw?.dispatches || raw?.data || []);
  const out = [];
  for (const d of rows || []) {
    const oid = oidToStr(d?._id?.$oid) || oidToStr(d?._id) || oidToStr(d?.oid) || oidToStr(d?.id);
    if (!oid) continue;
    const tripRaw = d?.tripId ?? d?.tripNumber ?? d?.trip_number ?? d?.number ?? null;
    out.push({ oid, tripId: tripRaw != null ? String(tripRaw) : null });
  }
  return out;
}
