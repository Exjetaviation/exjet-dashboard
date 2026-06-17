# Calendar — click a column header to drill down a view

**Date:** 2026-06-17
**Status:** Approved (design)

## Problem

The Operations Calendar (`frontend/src/pages/Calendar.jsx`) has Day / Week / Month /
Year views, navigated by `view` + `offset` state. To go from a Week (or Month/Year)
overview to a specific day, the user has to switch the view and then page with
Prev/Next to find the date. There's no way to click a date and jump straight to it.

## Goal

Clicking a **date column header** drills down one level to the finer view focused on
that date:
- **Week** header (a day) → **Day** view of that day.
- **Month** header (a day number) → **Day** view of that day.
- **Year** header (a month) → **Month** view of that month.
- **Day** view headers (hours) → no action (bottom of the hierarchy).

Non-goals: clicking inside the grid body (flight blocks already open flight details
and the body is the drag-to-scroll surface — left untouched); breadcrumb/back UI
(Prev/Next + the view switcher already exist).

## Why headers (resolved during brainstorming)

The header row (`hdrRef`) is separate from the scrollable grid body (`bodyRef`): it has
no flight blocks and no drag-to-scroll, so making header cells clickable can't hijack
flight-detail navigation or panning. Year drills to Month (one level) rather than
straight to Day because the year's day-columns are too thin (365) to click precisely;
Year→Month→Day is the natural hierarchy.

## Design

### A. Offset math — two pure helpers

Navigation reduces to `setView(target)` + `setOffset(delta)`, because `getRangeStart()`
derives the visible range from `view + offset` relative to *now*:
- Day: `todayMidnight + offset*86400000`
- Month: `new Date(now.getFullYear(), now.getMonth()+offset, 1)`

Add to `frontend/src/lib/calendarRange.js` (pure, unit-tested):

- `dayOffsetFromNow(nowMs, targetMs)` → whole-day delta:
  `Math.round((floorDay(targetMs) - floorDay(nowMs)) / 86400000)` where `floorDay`
  zeroes the local time-of-day. Drives Week→Day and Month→Day.
- `monthOffsetFromNow(nowMs, targetMs)` →
  `(tYear - nYear) * 12 + (tMonth - nMonth)` from local `Date` parts. Drives Year→Month.

These mirror exactly how `getRangeStart` interprets `offset`, so the computed offset
lands the new view on the clicked date.

### B. Navigation handler in `Calendar.jsx`

A small `drillTo(targetView, targetMs)` that:
1. computes the offset via the matching helper (`day` → `dayOffsetFromNow`, `month` →
   `monthOffsetFromNow`),
2. `setView(targetView)`, `setOffset(offset)`,
3. resets the body's horizontal scroll to 0 (next tick) so the new view opens at the
   focused day/month instead of inheriting the prior view's scroll position.

`autoFit` already refits the zoom on `view` change (its effect depends on `view`), so
the target view sizes correctly with no extra work.

### C. Click targets + affordance

In the header column render (the `cols.map(...)` inside the header row), attach an
`onClick` to each cell **only when the current view has a drill target**:
- `view === 'week' || view === 'month'` → `onClick={() => drillTo('day', col.ts)}`
- `view === 'year'` → `onClick={() => drillTo('month', col.ts)}`
- `view === 'day'` → no handler.

Drill-target cells get `cursor: 'pointer'`, a subtle hover background (a faint accent
tint in the family of the existing today-highlight `rgba(79,142,247,0.12)` — applied on
hover via a React `onMouseEnter/Leave` or a CSS class), and a `title`
("Open day" / "Open month"). Non-target headers keep the current static styling. No
layout change — only interactivity on cells that already render.

## Data flow

User clicks a Week/Month day header → `drillTo('day', col.ts)` → offset =
`dayOffsetFromNow(Date.now(), col.ts)` → Day view renders that date. Year month header
→ `drillTo('month', col.ts)` → Month view of that month. `view`/`offset` persist to
localStorage as they already do, so the drilled-to view survives reload.

## Edge cases

- The clicked column's true date is `col.ts` (= `rangeStart + i*colMs`), so drilling
  works from any navigated week/month/year, not just the current one.
- Year→Month uses the clicked day's month, so clicking anywhere in a month's header
  strip lands on that month.
- Day view headers are inert (no finer level) — no pointer cursor, no handler.
- DST/length-of-day: `dayOffsetFromNow` uses `floorDay` (local midnight) deltas,
  consistent with how `getRangeStart` builds the Day range, so the target day matches.

## Testing

Unit-test the two pure helpers in `calendarRange.test.js`:
- `dayOffsetFromNow`: same day → 0; next calendar day → 1; previous day → -1;
  a time later the same day → 0.
- `monthOffsetFromNow`: same month → 0; next month → 1; January → December of the
  prior year → -1 (cross-year).

Navigation + affordance (state changes, cursor/hover, scroll reset) verified via
`npx eslint` + `npm run build` + manual click-through: clicking a day in Week and Month
opens Day view on that date; clicking a month in Year opens Month view; Day view
headers do nothing.

## Files touched

- `frontend/src/lib/calendarRange.js` (modify — add `dayOffsetFromNow`, `monthOffsetFromNow`)
- `frontend/src/lib/calendarRange.test.js` (modify — tests for the two helpers)
- `frontend/src/pages/Calendar.jsx` (modify — `drillTo` handler + clickable header cells with affordance)
