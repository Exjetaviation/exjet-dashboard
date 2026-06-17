# Calendar Drill-Down Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a date column header drills down one level — Week/Month day → Day view of that day, Year month → Month view of that month.

**Architecture:** Two pure offset helpers (`dayOffsetFromNow`, `monthOffsetFromNow`) compute the `offset` for a target view from a clicked timestamp, mirroring how `getRangeStart` interprets `offset`. A `drillTo(targetView, ts)` handler in `Calendar.jsx` sets `view`+`offset` and resets scroll; the header column cells become clickable (cursor + hover + title) on non-Day views. Header-only — the grid body (flight blocks, drag-scroll) is untouched.

**Tech Stack:** React + Vite, `node:test`.

---

## File Structure

- `frontend/src/lib/calendarRange.js` (modify) — add `dayOffsetFromNow`, `monthOffsetFromNow` (pure). Unit-tested.
- `frontend/src/lib/calendarRange.test.js` (modify) — tests for the two helpers.
- `frontend/src/pages/Calendar.jsx` (modify) — `drillTo` handler + clickable header cells.

---

## Task 1: Offset helpers + tests

**Files:**
- Modify: `frontend/src/lib/calendarRange.js`
- Test: `frontend/src/lib/calendarRange.test.js`

**Context:** `getRangeStart()` builds Day range as `localMidnight(today) + offset*86400000` and Month range as `new Date(now.getFullYear(), now.getMonth()+offset, 1)`. So the offset to land on a target date is the local-day delta (Day) or the calendar-month delta (Month).

- [ ] **Step 1: Append failing tests to `frontend/src/lib/calendarRange.test.js`**

Add at the end (keep the existing `overnightExtraCols` tests and the existing imports — extend the import line):

Change the import line at the top of the test file from:
```js
import { overnightExtraCols } from './calendarRange.js';
```
to:
```js
import { overnightExtraCols, dayOffsetFromNow, monthOffsetFromNow } from './calendarRange.js';
```

Then append:
```js
// Build local-time instants so the local-midnight flooring in the helpers is
// deterministic regardless of the test runner's timezone.
const mk = (y, mo, d, h = 0) => new Date(y, mo, d, h, 0, 0, 0).getTime();

test('dayOffsetFromNow: same day is 0, later same day still 0', () => {
  assert.equal(dayOffsetFromNow(mk(2026, 5, 17, 9), mk(2026, 5, 17, 15)), 0);
});

test('dayOffsetFromNow: next day is +1, previous day is -1', () => {
  assert.equal(dayOffsetFromNow(mk(2026, 5, 17, 23), mk(2026, 5, 18, 1)), 1);
  assert.equal(dayOffsetFromNow(mk(2026, 5, 17, 1), mk(2026, 5, 16, 23)), -1);
});

test('monthOffsetFromNow: same month 0, next month +1', () => {
  assert.equal(monthOffsetFromNow(mk(2026, 5, 17), mk(2026, 5, 2)), 0);
  assert.equal(monthOffsetFromNow(mk(2026, 5, 17), mk(2026, 6, 2)), 1);
});

test('monthOffsetFromNow: crosses year boundary (Jan 2026 -> Dec 2025 = -1)', () => {
  assert.equal(monthOffsetFromNow(mk(2026, 0, 5), mk(2025, 11, 20)), -1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && node --test src/lib/calendarRange.test.js`
Expected: FAIL — `dayOffsetFromNow`/`monthOffsetFromNow` not exported.

- [ ] **Step 3: Add the helpers to `frontend/src/lib/calendarRange.js`**

Append:
```js
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && node --test src/lib/calendarRange.test.js`
Expected: PASS — all tests (existing `overnightExtraCols` + 4 new) green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/calendarRange.js frontend/src/lib/calendarRange.test.js
git commit -m "Add dayOffsetFromNow/monthOffsetFromNow helpers for calendar drill-down"
```

---

## Task 2: `drillTo` + clickable headers in `Calendar.jsx`

**Files:**
- Modify: `frontend/src/pages/Calendar.jsx`

**Context:** The header column cells are rendered in `cols.map(col=>{ ... })` inside the header row. Each `col` has `col.ts` (the column's timestamp = `rangeStart + i*colMs`), `col.d`, `col.isToday`, `col.isMonthStart`, `col.isDayStart`. The component already imports `overnightExtraCols` from `../lib/calendarRange` and defines handlers like `goToToday` via `useCallback`. `bodyRef` is the scrollable grid body, `setView`/`setOffset` are the state setters.

- [ ] **Step 1: Extend the import**

Change:
```js
import { overnightExtraCols } from '../lib/calendarRange';
```
to:
```js
import { overnightExtraCols, dayOffsetFromNow, monthOffsetFromNow } from '../lib/calendarRange';
```

- [ ] **Step 2: Add the `drillTo` handler**

Immediately after the `goToToday` definition:
```js
  const goToToday = useCallback(() => { setOffset(0); setTimeout(scrollToCenter,80); }, [scrollToCenter]);
```
add:
```js
  // Drill down one level from a clicked header column: Week/Month day -> Day view of
  // that day; Year month -> Month view of that month. Offset mirrors getRangeStart.
  const drillTo = useCallback((targetView, ts) => {
    const off = targetView === 'month'
      ? monthOffsetFromNow(Date.now(), ts)
      : dayOffsetFromNow(Date.now(), ts);
    setView(targetView);
    setOffset(off);
    setTimeout(() => { if (bodyRef.current) bodyRef.current.scrollLeft = 0; }, 0);
  }, []);
```

- [ ] **Step 3: Make the header cells clickable**

Replace the start of the header `cols.map` callback through the cell's opening `<div>`:

```jsx
                {cols.map(col=>{
                  const daysInThisMonth = view==='year'&&col.isMonthStart
                    ? new Date(col.d.getFullYear(), col.d.getMonth()+1, 0).getDate()
                    : 0;
                  return (
                    <div key={col.i} style={{width:colW,minWidth:colW,height:HDR_H,display:'flex',alignItems:'center',justifyContent:'center',borderRight:col.isMonthStart||col.isDayStart?'2px solid rgba(255,255,255,0.16)':'1px solid rgba(255,255,255,0.04)',background:col.isToday?'rgba(79,142,247,0.12)':'transparent',flexShrink:0,overflow:'visible',position:'relative'}}>
```
with:
```jsx
                {cols.map(col=>{
                  const daysInThisMonth = view==='year'&&col.isMonthStart
                    ? new Date(col.d.getFullYear(), col.d.getMonth()+1, 0).getDate()
                    : 0;
                  // Non-Day views drill down on click: Year -> Month, Week/Month -> Day.
                  const drillTarget = view==='year' ? 'month' : view==='day' ? null : 'day';
                  const baseBg = col.isToday?'rgba(79,142,247,0.12)':'transparent';
                  return (
                    <div key={col.i}
                      onClick={drillTarget ? () => drillTo(drillTarget, col.ts) : undefined}
                      onMouseEnter={drillTarget ? (e)=>{ e.currentTarget.style.background='rgba(79,142,247,0.22)'; } : undefined}
                      onMouseLeave={drillTarget ? (e)=>{ e.currentTarget.style.background=baseBg; } : undefined}
                      title={drillTarget ? (drillTarget==='month'?'Open month':'Open day') : undefined}
                      style={{width:colW,minWidth:colW,height:HDR_H,display:'flex',alignItems:'center',justifyContent:'center',borderRight:col.isMonthStart||col.isDayStart?'2px solid rgba(255,255,255,0.16)':'1px solid rgba(255,255,255,0.04)',background:baseBg,flexShrink:0,overflow:'visible',position:'relative',cursor:drillTarget?'pointer':'default'}}>
```

(The rest of the cell body — the `view==='year' ? (...) : (...)` label block and the closing tags — is unchanged. Note the year month-name overlay already has `pointerEvents:'none'`, so clicks fall through to this cell and drill to that month.)

- [ ] **Step 4: Lint + build**

Run: `cd frontend && npx eslint src/pages/Calendar.jsx src/lib/calendarRange.js && npm run build 2>&1 | grep -E "built in|error|Error" | head`
Expected: eslint clean; `✓ built in ...` no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Calendar.jsx
git commit -m "Calendar: click a date header to drill down (week/month->day, year->month)"
```

---

## Task 3: Verification

- [ ] **Step 1: Helper tests + lint + build**

Run: `cd frontend && node --test src/lib/calendarRange.test.js && npx eslint src/pages/Calendar.jsx src/lib/calendarRange.js && npm run build 2>&1 | grep -E "built in|error|Error" | head`
Expected: all helper tests pass; eslint clean; build ✓.

- [ ] **Step 2: Manual check (running frontend + backend)**

- **Week view**: clicking a day header (e.g. "Mon 16") switches to **Day view** on that date; hovering the header shows a pointer + subtle highlight + "Open day" tooltip.
- **Month view**: clicking a day number switches to **Day view** on that date.
- **Year view**: clicking within a month switches to **Month view** of that month ("Open month" tooltip).
- **Day view**: header hour cells are inert (no pointer, no navigation).
- Works after paging Prev/Next (drills to the *clicked* date, not today); the grid body's flight-block clicks and drag-to-scroll still behave as before.

---

## Notes for the implementer

- **Header-only:** do not add click handling to the grid body — flight blocks open flight details and the body is the drag-scroll surface.
- **Offset is relative to `Date.now()`** at click time, matching `getRangeStart`; `col.ts` is the clicked column's real timestamp, so drilling works from any navigated range.
- **`drillTo` deps `[]`:** it only uses stable setters (`setView`/`setOffset`), the stable `bodyRef`, and the imported pure helpers — no reactive deps needed.
- **Scope:** Day view stays inert (bottom of the hierarchy). No breadcrumb/back UI — Prev/Next + the view switcher already cover going back up.
