// Pure helper for the Operations Calendar Day view. Given the visible legs and the
// focused day's start (epoch ms) + column size (ms, = 1h in Day view), return how
// many extra hourly columns the timeline must render PAST midnight to fully contain
// any overnight flight that DEPARTS within the focused day. Returns 0 when nothing
// crosses midnight (normal day is unchanged). Capped to avoid pathological widths
// from bad data. No I/O — unit-tested in calendarRange.test.js.
export function overnightExtraCols(legs, dayStartMs, colMs, maxExtra = 48) {
  const dayEnd = dayStartMs + 24 * 3600000;
  let maxArr = dayEnd;
  for (const leg of legs || []) {
    const dep = leg?.departure?.time;
    const arr = leg?.arrival?.time;
    if (dep == null || arr == null) continue;
    if (dep >= dayStartMs && dep < dayEnd && arr > maxArr) maxArr = arr;
  }
  if (maxArr <= dayEnd) return 0;
  return Math.min(Math.ceil((maxArr - dayEnd) / colMs), maxExtra);
}

// Local midnight (ms) for a timestamp — matches how getRangeStart() builds the
// Day range (it zeroes the local time-of-day).
function floorDayLocal(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Whole-day delta between two instants, by local calendar day. Drives Week/Month
// header -> Day view. Math.round absorbs DST-shortened/lengthened days.
export function dayOffsetFromNow(nowMs, targetMs) {
  return Math.round((floorDayLocal(targetMs) - floorDayLocal(nowMs)) / 86400000);
}

// Calendar-month delta between two instants. Drives Year header -> Month view.
export function monthOffsetFromNow(nowMs, targetMs) {
  const n = new Date(nowMs), t = new Date(targetMs);
  return (t.getFullYear() - n.getFullYear()) * 12 + (t.getMonth() - n.getMonth());
}
