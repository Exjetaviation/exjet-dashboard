// backend/src/scheduling/dispatchStatus.js
//
// Trip status model. Mirrored trips carry LevelFlight's numeric dispatch codes;
// trips advanced via the workflow action buttons carry our string statuses.
// statusLabel renders either. The action buttons set the string statuses.

// LevelFlight numeric dispatch codes (as they arrive in mirrored data).
const LF_CODE_LABELS = { 0: 'Booked', 2: 'Closed', 4: 'In Progress' };

// Our workflow statuses (set by the trip action buttons).
const WORKFLOW_LABELS = {
  quote: 'Quote', booked: 'Booked', released: 'Released', closed: 'Closed', cancelled: 'Cancelled',
};

export function statusLabel(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' && WORKFLOW_LABELS[value]) return WORKFLOW_LABELS[value];
  const n = Number(value);
  if (Number.isFinite(n) && LF_CODE_LABELS[n] !== undefined) return LF_CODE_LABELS[n];
  return String(value);
}

// The workflow action buttons (label + the status each sets), in lifecycle order.
export const STATUS_ACTIONS = [
  { action: 'book', label: 'Book', status: 'booked' },
  { action: 'release', label: 'Release', status: 'released' },
  { action: 'close', label: 'Close', status: 'closed' },
  { action: 'cancel', label: 'Cancel', status: 'cancelled' },
];

const SETTABLE = new Set(['quote', 'booked', 'released', 'closed', 'cancelled']);

// A status a dispatcher may set via the workflow buttons (string statuses only).
export function isSettableStatus(value) {
  return typeof value === 'string' && SETTABLE.has(value);
}
