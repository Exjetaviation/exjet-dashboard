// backend/src/scheduling/dispatchStatus.js
//
// LevelFlight dispatch (trip) status enum, confirmed against live data.
// Distinct from the per-leg status enum used by the read-only list components.
export const DISPATCH_STATUS_LABELS = { 0: 'Booked', 2: 'Closed', 4: 'In Progress' };

export function dispatchStatusLabel(code) {
  if (Object.prototype.hasOwnProperty.call(DISPATCH_STATUS_LABELS, code)) {
    return DISPATCH_STATUS_LABELS[code];
  }
  return code == null ? '—' : `Status ${code}`;
}

// Only codes a dispatcher may set in this slice (must be a number we know).
export function isEditableStatus(code) {
  return typeof code === 'number' && Object.prototype.hasOwnProperty.call(DISPATCH_STATUS_LABELS, code);
}
