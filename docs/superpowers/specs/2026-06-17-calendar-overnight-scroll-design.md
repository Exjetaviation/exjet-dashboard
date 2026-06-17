# Calendar — overnight flights scroll fully in Day view

**Date:** 2026-06-17
**Status:** Approved (design)

## Problem

The calendar (`frontend/src/pages/Calendar.jsx`) is a horizontal timeline (aircraft
rows × time columns) with Day / Week / Month / Year views. Flights are
absolute-positioned blocks sized by time via `getBlock(dep, arr)`, which **hard-clips
every flight to the visible range** `[rangeStart, rangeEnd]`:

```js
const getBlock = (dep,arr) => {
  if (!dep||!arr||arr<rangeStart||dep>rangeEnd) return null;
  const left  = ((Math.max(dep,rangeStart)-rangeStart)/totalMs)*totalW;
  const width = Math.max(((Math.min(arr,rangeEnd)-Math.max(dep,rangeStart))/totalMs)*totalW, 3);
  return {left,width};
};
```

In **Day view** the range is exactly 24h (focused day 00:00 → +24h), so an overnight
flight (e.g. departs 11pm, arrives 2am next day) is sliced at midnight: its tail only
appears on the *next* day's page, and it can never be seen in full on one page.

## Goal

In Day view, let an overnight flight render at its true length and be followed by
**scrolling horizontally across midnight**, with the day boundary clearly marked —
without changing how normal days look or losing the premium feel. Week/Month/Year
views are unchanged.

Non-goals: redesigning the timeline; changing other views; the "mirror" case (a
flight that departed the previous day and lands during the focused morning) — that
flight is already fully visible on its own departure day, so we don't extend the
range backward.

## Design

### A. Dynamic Day-view range end

Today Day view fixes `rangeEnd = rangeStart + 24h`. Change it so, **in Day view only**,
`rangeEnd` is the later of:
- the focused day's 24:00 (so a day with no overnight flights is unchanged), and
- the latest `arrival.time` among flights that **depart within** the focused day
  (`dep >= rangeStart && dep < focusedDayEnd`), rounded **up to the next whole hour**.

`totalMs` becomes `rangeEnd - rangeStart` as usual. Pixels-per-hour stays constant, so
the scroll-canvas width (`totalW`) grows proportionally only when an overnight flight
pushes `rangeEnd` past midnight. `getBlock` then clips to the extended `rangeEnd`, so
the overnight block renders full instead of cut at midnight. **No change to `getBlock`
itself** — it just receives a range that already covers the flight.

Other views compute `rangeEnd` exactly as today (no behavior change).

### B. Continuous scroll + midnight markers

The body already scrolls horizontally (`overflowX:'scroll'` on the rows container) at a
fixed pixels-per-hour, so a wider Day-view range is simply more scrollable canvas —
scrolling right follows the overnight flight smoothly across midnight with no jump.

To keep it legible and premium, render at **each midnight boundary inside the range**
(there will be 0 such interior boundaries on a normal 24h day, 1 for a typical
overnight):
- a **day-divider** vertical gridline, visually stronger than the faint hourly lines
  (e.g. `var(--border)` at full opacity / 2px vs. the hourly faint line), and
- a small **date label** in the header above that divider (format reuses the existing
  `fmt`/ET helpers, e.g. "Wed Jun 18").

Hourly column labels continue past midnight (…23:00, 00:00, 01:00…), generated from the
same loop that builds Day-view columns — it now iterates to the extended `rangeEnd`.

### C. Initial scroll position & navigation

- Initial horizontal scroll stays at the focused day's 00:00 (left edge), so "today"
  shows first and the user scrolls right to follow a red-eye. (If the scroll position
  is currently implicit at 0, no change needed.)
- Prev/next-day navigation, the "now" current-time line, hover tooltips, trip colors,
  the maintenance strip, and all styling are unchanged.

## Components / files

- `frontend/src/pages/Calendar.jsx` (modify):
  - Day-view `rangeEnd` computation → dynamic (Section A). Locate the range/`totalMs`
    derivation (around the `getRangeStart` helper, ~lines 92–110, and the
    `totalMs`/`totalW` definitions) and branch Day view to the dynamic end.
  - Day-view column/label generation loop → iterate to the new `rangeEnd`; mark
    interior midnights with a day-divider + date label (Section B).
  - No change to `getBlock`, flight-block rendering, or other views.

This stays within the existing component; it's a localized change to the Day-view
range math plus the column-rendering loop. If the range/column logic is tangled enough
that the change would bloat the render body, extract a small helper
`dayViewRange(focusedDayStart, legs)` returning `{ rangeStart, rangeEnd }` — pure and
unit-testable — and a `midnightBoundaries(rangeStart, rangeEnd)` helper for the
dividers.

## Edge cases

- **No overnight flights** → `rangeEnd` = focused day 24:00; canvas is exactly 24h;
  pixel-for-pixel identical to today (no interior midnight markers).
- **Multiple overnight flights** → `rangeEnd` covers the latest arrival; one midnight
  divider (or more, for a >24h red-eye) rendered.
- **Very long red-eye (>24h block)** → range extends to its arrival; scrollbar reflects
  the longer canvas; multiple midnight dividers as needed.
- **Flight departing exactly at/after midnight of the focused day** → belongs to that
  day normally; not treated as overnight.
- **Mirror case** (departed previous day, lands this morning) → still clipped at 00:00
  on the focused day; fully visible on its departure day. Out of scope by decision.

## Testing

`Calendar.jsx` is a presentational component with no existing tests. If the range and
midnight-boundary logic is extracted into pure helpers (`dayViewRange`,
`midnightBoundaries`), add a `node:test` (or the project's frontend `node:test` pattern
used for `formatElapsed`) covering:
- `dayViewRange` returns exactly 24h when no leg crosses midnight.
- `dayViewRange` extends to the latest overnight arrival, rounded up to the hour.
- `midnightBoundaries` returns `[]` for a 24h range and the correct midnight timestamp(s)
  for an extended range.

Otherwise (logic left inline): verify via `npx eslint` + `npm run build` + manual —
a known overnight flight scrolls fully into view past a labeled midnight divider in Day
view; a normal day looks unchanged; Week/Month/Year unaffected.

## Files touched

- `frontend/src/pages/Calendar.jsx` (modify — dynamic Day-view range + midnight dividers/labels)
- (optional) a small pure helper module + its test, if the range/boundary logic is extracted.
