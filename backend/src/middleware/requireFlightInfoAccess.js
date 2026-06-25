// backend/src/middleware/requireFlightInfoAccess.js
import { canEditScheduling } from '../scheduling/canEdit.js';

export function isCrewOnLeg(legRow, email) {
  if (!legRow || !email) return false;
  const snap = legRow.lf_synced_snapshot || {};
  const people = [...(snap.pilots || []), ...(snap.attendants || [])];
  const e = String(email).toLowerCase();
  return people.some((p) => String(p?.user?.email || '').toLowerCase() === e);
}

// Express middleware: allow scheduling editors OR crew assigned to the leg.
// Expects req.legRow to be loaded by the route (from scheduling_legs).
export function requireFlightInfoAccess(req, res, next) {
  if (canEditScheduling(req.user?.role)) return next();
  if (isCrewOnLeg(req.legRow, req.user?.email)) return next();
  return res.status(403).json({ error: 'Not authorized to edit this flight info' });
}
