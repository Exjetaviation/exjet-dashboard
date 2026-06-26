// Group flight-duty periods for the calendar's per-aircraft duty bracket.
//
// Crew on the same flight (PIC seat 2 + SIC seat 3) usually report within a few
// minutes of each other, so we collapse near-simultaneous duties into one bracket
// and draw a single START/END marker. When crew start far enough apart, each gets
// its own bracket so both duty starts are visible.
//
// A duty joins the current group when its `_start` is within `gapMs` of that
// group's FIRST (earliest) start; otherwise it opens a new group. For the common
// two-pilot case this is exactly "within gapMs of each other".
// `duties`: objects with a numeric `_start`. Returns groups (arrays), each
// non-empty, ordered by start.
export function groupDutiesByStart(duties, gapMs) {
  const sorted = [...(duties || [])].sort((a, b) => a._start - b._start);
  const groups = [];
  for (const d of sorted) {
    const last = groups[groups.length - 1];
    if (last && d._start - last[0]._start <= gapMs) last.push(d);
    else groups.push([d]);
  }
  return groups;
}
