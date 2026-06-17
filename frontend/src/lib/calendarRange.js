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
