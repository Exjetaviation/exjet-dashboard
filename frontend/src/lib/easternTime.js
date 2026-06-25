// Eastern-time helpers for the quote form. Dispatchers enter ETD in local Eastern
// time (the operation's home zone); we store/compute in UTC and show a Zulu (UTC)
// conversion. Uses the IANA zone so daylight saving is automatic — EDT (UTC-4) in
// summer, EST (UTC-5) in winter.
const ET = 'America/New_York';

// Offset (ET wall clock − UTC), in ms, at a given UTC instant.
function etOffsetMs(utcMs) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ET, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  const hour = p.hour === '24' ? 0 : Number(p.hour); // Intl may emit '24' at midnight
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
  return asUTC - utcMs;
}

// "YYYY-MM-DD" + "HH:mm" interpreted as Eastern wall-clock -> UTC Date (DST-aware).
export function easternToUTC(dateStr, timeStr) {
  if (!dateStr) return null;
  const [y, mo, d] = String(dateStr).split('-').map(Number);
  const [h, mi] = String(timeStr || '00:00').split(':').map(Number);
  if (!y || !mo || !d) return null;
  // Treat the wall clock as if it were UTC, then back out the zone offset at that
  // instant. One pass is exact except inside the spring-forward gap (no real time).
  const guess = Date.UTC(y, mo - 1, d, h || 0, mi || 0);
  return new Date(guess - etOffsetMs(guess));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// UTC date label + 24h HHMM clock for Zulu display: { date: 'Jun 20', time: '1830' }.
export function zuluParts(date) {
  if (!date || isNaN(date)) return null;
  return {
    date: `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`,
    time: `${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}`,
  };
}

// Eastern date label + 24h HHMM clock + zone tag, e.g. { date: 'Jun 20', time: '1430', zone: 'EDT' }.
// Mirrors zuluParts but in the operation's home zone (DST-aware).
export function easternParts(date) {
  if (!date || isNaN(date)) return null;
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ET, hour12: false,
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
  const p = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  const hour = p.hour === '24' ? '00' : p.hour; // Intl may emit '24' at midnight
  return {
    date: `${p.month} ${p.day}`,
    time: `${hour.padStart(2, '0')}${p.minute}`,
    zone: p.timeZoneName,
  };
}

// Eastern wall-clock display with zone tag, e.g. "Jun 20, 2:30 PM EDT".
export function formatEastern(date) {
  if (!date || isNaN(date)) return null;
  return date.toLocaleString('en-US', {
    timeZone: ET, month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

// UTC epoch ms -> Eastern wall clock as input-field values:
// { date: 'YYYY-MM-DD', clock: 'HH:mm' } (DST-aware). Inverse of easternToUTC,
// used to load a stored leg time into the quote editor's date/time inputs.
export function easternInputParts(ms) {
  if (ms == null || isNaN(ms)) return { date: '', clock: '' };
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: ET, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(ms))) p[part.type] = part.value;
  const hour = p.hour === '24' ? '00' : p.hour; // Intl may emit '24' at midnight
  return { date: `${p.year}-${p.month}-${p.day}`, clock: `${hour}:${p.minute}` };
}
