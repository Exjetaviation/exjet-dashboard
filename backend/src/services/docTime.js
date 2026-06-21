// backend/src/services/docTime.js
//
// Shared time formatting for passenger/crew documents (itinerary, quote, trip
// sheet): Eastern — the operation's time zone, auto EST/EDT — as the primary
// readable time, with Zulu (UTC) shown beneath it.
export const easternTime = (ms) => (ms == null ? '' : new Date(ms).toLocaleString('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
}));

export const zuluTime = (ms) => (ms == null ? '' : new Date(ms).toLocaleString('en-GB', {
  timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false,
}) + 'Z');
