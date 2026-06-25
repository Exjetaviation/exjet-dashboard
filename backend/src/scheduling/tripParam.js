// Map a trip route param to the scheduling_trips column to filter on.
// Mirrored trips are addressed by their 24-hex LevelFlight oid, native trips by
// uuid, and (new) booked trips by their provisional trip_number when neither
// shape matches. trip_number is TEXT — compare as TEXT, never via SQL ORDER BY.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OID_RE = /^[0-9a-f]{24}$/i;

export function tripParamColumn(param) {
  const p = String(param || '');
  if (UUID_RE.test(p)) return 'id';
  if (OID_RE.test(p)) return 'lf_oid';
  return 'trip_number';
}
