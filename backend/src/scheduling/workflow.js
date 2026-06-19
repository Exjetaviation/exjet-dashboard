// backend/src/scheduling/workflow.js
//
// Trip operational state machine: Quote -> Book -> Released -> (auto) Closed,
// with Cancel available until closed. Statuses may be our workflow strings or,
// for mirrored trips not yet advanced here, LevelFlight numeric codes — both
// normalize to a stage.
const STRING_STAGES = new Set(['quote', 'booked', 'released', 'closed', 'cancelled']);

export function workflowStage(status) {
  if (typeof status === 'string' && STRING_STAGES.has(status)) return status;
  if (status === null || status === undefined || status === '') return 'quote';
  const n = Number(status);
  if (n === 0) return 'booked';
  if (n === 4) return 'released';
  if (n === 2) return 'closed';
  return 'quote';
}

// Forward actions available from each stage (button label + the status it sets).
// Note: there is no manual "Close" — a released trip closes automatically once
// the flight is complete (see shouldAutoClose).
const TRANSITIONS = {
  quote: [
    { action: 'book', label: 'Book', status: 'booked' },
    { action: 'cancel', label: 'Cancel', status: 'cancelled' },
  ],
  booked: [
    { action: 'release', label: 'Release', status: 'released' },
    { action: 'cancel', label: 'Cancel', status: 'cancelled' },
  ],
  released: [
    { action: 'cancel', label: 'Cancel', status: 'cancelled' },
  ],
  closed: [],
  cancelled: [],
};

export function nextActions(status) {
  return TRANSITIONS[workflowStage(status)] || [];
}

export function isValidTransition(currentStatus, newStatus) {
  return nextActions(currentStatus).some((a) => a.status === newStatus);
}

// A released trip auto-closes once EVERY leg has arrived (the flight is complete).
// Gated on the literal 'released' status so mirrored LevelFlight trips (which LF
// manages) are not closed out from under it.
export function shouldAutoClose(status, legArrMs, now) {
  if (status !== 'released') return false;
  if (!legArrMs.length) return false;
  const nowMs = new Date(now).getTime();
  return legArrMs.every((ms) => ms != null && ms < nowMs);
}
