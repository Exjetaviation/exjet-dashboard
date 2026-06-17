# Calendar Overnight-Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the calendar's Day view, let an overnight flight render at full length and be scrolled across midnight (with a labeled day-divider), without changing how normal days look.

**Architecture:** Extend the Day-view rendered range past midnight just enough to contain overnight flights (a pure helper computes the extra hourly columns). Crucially, keep `autoFit` fitting the *focused* 24h (`fitCols`) while the canvas *renders* the extended range (`effectiveCols`), so the focused day still fills the viewport and the overnight tail becomes scrollable. Mark interior midnights with a stronger gridline + date label. `getBlock` is unchanged — it just receives a range that now covers the flight.

**Tech Stack:** React + Vite, Leaflet (n/a here), `node:test` for the pure helper.

---

## File Structure

- `frontend/src/lib/calendarRange.js` (new) — pure `overnightExtraCols(legs, dayStartMs, colMs)` helper. Unit-tested.
- `frontend/src/lib/calendarRange.test.js` (new) — `node:test` for the helper.
- `frontend/src/pages/Calendar.jsx` (modify) — use the helper to extend Day-view range; fit on focused day; render midnight day-dividers + date labels.

---

## Task 1: Pure helper `overnightExtraCols` + tests

**Files:**
- Create: `frontend/src/lib/calendarRange.js`
- Test: `frontend/src/lib/calendarRange.test.js`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/calendarRange.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overnightExtraCols } from './calendarRange.js';

const H = 3600000;
const day = Date.UTC(2026, 5, 17, 0, 0, 0); // a day start, epoch ms (helper is tz-agnostic)

test('returns 0 when no flight crosses midnight', () => {
  const legs = [{ departure: { time: day + 9 * H }, arrival: { time: day + 11 * H } }];
  assert.equal(overnightExtraCols(legs, day, H), 0);
});

test('extends by whole hours to the latest overnight arrival (rounds up)', () => {
  // departs 23:00, arrives 02:30 next day -> 2.5h past midnight -> ceil = 3
  const legs = [{ departure: { time: day + 23 * H }, arrival: { time: day + 26 * H + 30 * 60000 } }];
  assert.equal(overnightExtraCols(legs, day, H), 3);
});

test('ignores flights departing outside the focused day', () => {
  const legs = [
    { departure: { time: day - 2 * H }, arrival: { time: day + 5 * H } },   // departed previous day (mirror)
    { departure: { time: day + 25 * H }, arrival: { time: day + 28 * H } }, // departs next day
  ];
  assert.equal(overnightExtraCols(legs, day, H), 0);
});

test('uses the latest arrival among multiple overnight flights', () => {
  const legs = [
    { departure: { time: day + 22 * H }, arrival: { time: day + 25 * H } }, // +1h
    { departure: { time: day + 23 * H }, arrival: { time: day + 28 * H } }, // +4h
  ];
  assert.equal(overnightExtraCols(legs, day, H), 4);
});

test('skips legs missing times and null entries', () => {
  const legs = [{ departure: {}, arrival: {} }, null, { departure: { time: day + 23 * H } }];
  assert.equal(overnightExtraCols(legs, day, H), 0);
});

test('caps the extension at maxExtra (default 48)', () => {
  const legs = [{ departure: { time: day + 23 * H }, arrival: { time: day + 1000 * H } }];
  assert.equal(overnightExtraCols(legs, day, H), 48);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && node --test src/lib/calendarRange.test.js`
Expected: FAIL — `calendarRange.js` does not exist / no export.

- [ ] **Step 3: Write the helper**

Create `frontend/src/lib/calendarRange.js`:

```js
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && node --test src/lib/calendarRange.test.js`
Expected: PASS — 6/6.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/calendarRange.js frontend/src/lib/calendarRange.test.js
git commit -m "Add overnightExtraCols helper for calendar Day-view range extension"
```

---

## Task 2: Wire the extension + midnight markers into `Calendar.jsx`

**Files:**
- Modify: `frontend/src/pages/Calendar.jsx`

**Context:** Day view currently fixes `effectiveCols = cfg.cols` (24), `totalMs = effectiveCols*cfg.colMs`, `totalW = effectiveCols*colW`, `rangeEnd = rangeStart + totalMs`. `getBlock` clips flights to `[rangeStart, rangeEnd]`. `calcFitZoom` (and a "Fit" button) fit `effectiveCols*cfg.baseColW` into the viewport. The full leg list is `data?.legs||[]` (currently defined lower at the `const legs = data?.legs||[];` line). Columns are built into the `cols` array (hour labels for Day view), and the header + per-row gridlines render from `cols` keying off `isMonthStart`/`isToday`. `ET` and `floorDay` are defined at module top; `cfg.colMs` is 3600000 in Day view.

- [ ] **Step 1: Import the helper**

Add to the import group at the top of `frontend/src/pages/Calendar.jsx` (alongside the other `import` lines):

```js
import { overnightExtraCols } from '../lib/calendarRange';
```

- [ ] **Step 2: Compute `fitCols`, `dayExtraCols`, `effectiveCols` (and hoist `legs`)**

Replace this block:

```js
  const effectiveCols = view === 'month'
    ? new Date(new Date(rangeStart).getFullYear(), new Date(rangeStart).getMonth()+1, 0).getDate()
    : cfg.cols;
```
with:
```js
  const legs = data?.legs || [];

  // Columns that should FILL the viewport (drives autoFit). Day view fits the focused
  // 24h; month fits its day-count; week/year fit cfg.cols.
  const fitCols = view === 'month'
    ? new Date(new Date(rangeStart).getFullYear(), new Date(rangeStart).getMonth()+1, 0).getDate()
    : cfg.cols;
  // Day view only: extra hourly columns past midnight to fully contain overnight
  // flights (0 on a normal day -> identical to before). These render but are NOT
  // counted in the fit, so the focused day stays full-size and the tail scrolls.
  const dayExtraCols = view === 'day' ? overnightExtraCols(legs, rangeStart, cfg.colMs) : 0;
  const effectiveCols = fitCols + dayExtraCols;
```

Then DELETE the now-duplicate later declaration line:

```js
  const legs = data?.legs||[];
```
(It currently sits just above `const dutyTimes = dutyData?.dutyTimes||[];` — remove only the `legs` line; keep the `dutyTimes` line.)

> `totalMs`, `totalW`, and `rangeEnd` lines stay exactly as they are — they already
> derive from `effectiveCols`, which is now extended in Day view.

- [ ] **Step 3: Fit on the focused day, not the extended range**

In `calcFitZoom`, change the divisor and dependency from `effectiveCols` to `fitCols`:

```js
  const calcFitZoom = useCallback(() => {
  if (bodyRef.current) {
    return (bodyRef.current.clientWidth) / (fitCols * cfg.baseColW);
  }
  return 1;
}, [fitCols, cfg.baseColW]);
```

And in the inline "Fit" button that computes zoom directly, change `effectiveCols` to `fitCols`:

```js
            <button onClick={()=>setZoom((bodyRef.current?.clientWidth||800)/(fitCols*cfg.baseColW))} style={{padding:'0 8px',height:'30px',fontSize:'11px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'6px',cursor:'pointer',color:'var(--accent)',fontWeight:'600'}}>Fit</button>
```

- [ ] **Step 4: Mark interior midnights in the `cols` builder**

Replace this part of the `cols = Array.from(...)` callback:

```js
    let label='';
    if (view==='day') {
      const h=d.getHours();
      label=h===0?'12am':h===12?'12pm':h<12?`${h}am`:`${h-12}pm`;
    } else if (view==='week') {
```
with:
```js
    let label='';
    const isDayStart = view==='day' && i>0 && d.getHours()===0; // interior midnight
    if (view==='day') {
      if (isDayStart) {
        label=d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}); // e.g. "Wed, Jun 18"
      } else {
        const h=d.getHours();
        label=h===0?'12am':h===12?'12pm':h<12?`${h}am`:`${h-12}pm`;
      }
    } else if (view==='week') {
```

And add `isDayStart` to the returned column object — change:

```js
    return {i,ts,label,isToday,isMonthStart,d};
```
to:
```js
    return {i,ts,label,isToday,isMonthStart,isDayStart,d};
```

- [ ] **Step 5: Style the midnight divider in the header**

In the header column render, treat `isDayStart` like `isMonthStart` for the border and label emphasis. Change the cell `borderRight`:

```js
borderRight:col.isMonthStart?'2px solid rgba(255,255,255,0.16)':'1px solid rgba(255,255,255,0.04)',
```
to:
```js
borderRight:col.isMonthStart||col.isDayStart?'2px solid rgba(255,255,255,0.16)':'1px solid rgba(255,255,255,0.04)',
```

And the label `<span>` style:

```js
col.label && <span style={{fontSize:view==='month'?'11px':'12px',fontWeight:col.isToday||col.isMonthStart?'700':'400',color:col.isToday?'var(--accent)':col.isMonthStart?'#dde':'var(--text-secondary)',whiteSpace:'nowrap'}}>{col.label}</span>
```
to:
```js
col.label && <span style={{fontSize:view==='month'?'11px':'12px',fontWeight:col.isToday||col.isMonthStart||col.isDayStart?'700':'400',color:col.isToday?'var(--accent)':col.isMonthStart||col.isDayStart?'#dde':'var(--text-secondary)',whiteSpace:'nowrap'}}>{col.label}</span>
```

- [ ] **Step 6: Style the midnight divider in the per-row gridlines**

In the per-row grid-line render, change:

```js
                  {cols.map(col=>(
                    <div key={col.i} style={{position:'absolute',left:col.i*colW,top:0,bottom:0,width:col.isMonthStart?2:1,background:col.isMonthStart?'rgba(255,255,255,0.13)':'rgba(255,255,255,0.03)',pointerEvents:'none'}}/>
                  ))}
```
to:
```js
                  {cols.map(col=>(
                    <div key={col.i} style={{position:'absolute',left:col.i*colW,top:0,bottom:0,width:col.isMonthStart||col.isDayStart?2:1,background:col.isMonthStart||col.isDayStart?'rgba(255,255,255,0.13)':'rgba(255,255,255,0.03)',pointerEvents:'none'}}/>
                  ))}
```

- [ ] **Step 7: Lint + build**

Run: `cd frontend && npx eslint src/pages/Calendar.jsx src/lib/calendarRange.js && npm run build 2>&1 | grep -E "built in|error|Error" | head`
Expected: eslint clean; `✓ built in ...` no errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/Calendar.jsx
git commit -m "Calendar: scroll overnight flights fully in Day view with midnight dividers"
```

---

## Task 3: Verification

- [ ] **Step 1: Helper tests + lint + build**

Run: `cd frontend && node --test src/lib/calendarRange.test.js && npx eslint src/pages/Calendar.jsx src/lib/calendarRange.js && npm run build 2>&1 | grep -E "built in|error|Error" | head`
Expected: tests 6/6 pass; eslint clean; build ✓.

- [ ] **Step 2: Manual check (running frontend + backend)**

- **Normal day** (no overnight flight): Day view looks pixel-identical to before — 24 columns fill the viewport with autoFit on, no extra scroll.
- **Day with an overnight flight**: the flight block is no longer cut at midnight; a stronger vertical divider with a date label (e.g. "Wed, Jun 18") appears at midnight, and horizontally scrolling right follows the flight to its arrival.
- **Other views** (Week / Month / Year): unchanged.
- autoFit/Fit still sizes the focused day to the viewport (the overnight tail is reached by scrolling, not by shrinking the day).

---

## Notes for the implementer

- **Why `fitCols` vs `effectiveCols`:** autoFit divides the viewport width by the columns it must fit. Fitting the *extended* column count would shrink the whole day to cram the overnight tail on-screen (wonky). Fitting `fitCols` (focused 24h) keeps the day full-size and lets the extra columns overflow into the existing horizontal scroll.
- **`getBlock` is intentionally untouched** — extending `rangeEnd` (via `effectiveCols`) is sufficient for it to stop clipping the overnight block.
- **Midnight detection** uses `d.getHours()===0`, matching the existing hour-label logic (the calendar's columns step in local hours; this is consistent with current behavior — do not change the range's timezone handling).
- **Scope:** Day view only. Week/Month/Year keep `dayExtraCols = 0`. Do not alter other views or the mirror case (a flight that departed the previous day).
