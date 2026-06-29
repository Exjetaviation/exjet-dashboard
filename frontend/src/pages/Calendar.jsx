import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useApi } from '../hooks/useApi';
import { useAdsb } from '../hooks/useAdsb';
import { useLegActuals } from '../hooks/useLegActuals';
import { useNavigate } from 'react-router-dom';
import { overnightExtraCols, dayOffsetFromNow, monthOffsetFromNow } from '../lib/calendarRange';
import { easternParts, zuluParts } from '../lib/easternTime';
import { groupDutiesByStart } from '../lib/dutyGroups';
import DivertModal from '../components/DivertModal';
const STATUS = { 0:{label:'Scheduled'},1:{label:'Active'},2:{label:'Booked'},3:{label:'Completed'} };
const VIEWS = {
  '12h': { label:'12 hr', colMs:3600000,  cols:12,  baseColW:160, stepMs:43200000    },
  day:   { label:'Day',   colMs:3600000,  cols:24,  baseColW:80,  stepMs:86400000    },
  week:  { label:'Week',  colMs:86400000, cols:7,   baseColW:150, stepMs:604800000   },
  month: { label:'Month', colMs:86400000, cols:31,  baseColW:40,  stepMs:2592000000  },
  year:  { label:'Year',  colMs:86400000, cols:365, baseColW:16,  stepMs:31536000000 },
};
// Day / 12h are CONTINUOUS: instead of paging one day at a time, the timeline spans
// every flight (earliest → latest, always including today) and you scroll straight
// through it — no per-day reload. See the range computation in the component.

// Block colour by flight STATE (uses actuals when known): completed/landed = blue,
// in-flight = green, future/not-yet-departed = grey.
const STATE_COLORS = { completed:'#4f8ef7', inflight:'#22c55e', future:'#64748b' };
// Whether to TRUST/show an actual arrival: present, and not before a known departure
// (arr <= dep = corrupt → ignore). An arrival with NO recorded departure is still valid
// — ADS-B routinely misses the wheels-up — so a flight that lands without a captured
// takeoff still renders (scheduled departure as the bar start) instead of vanishing on
// landing. (The backend matcher's coherentArrival stays stricter on purpose.)
const arrShown = (dep, arr) => arr != null && (dep == null || arr > dep);
function legStateColor(leg, isAirborne, act, now) {
  const dep = leg?.departure?.time, arr = leg?.arrival?.time;
  const aDep = act?.actualDep ?? null;
  const aArr = arrShown(act?.actualDep, act?.actualArr) ? act.actualArr : null; // ignore only corrupt arrivals (arr<=dep)
  if (isAirborne) return STATE_COLORS.inflight;                                   // ADS-B says airborne
  if (aArr != null) return aArr <= now ? STATE_COLORS.completed : STATE_COLORS.inflight; // truly landed
  if (aDep != null) {
    // Departed but no coherent arrival: in-flight, never "complete" on a corrupt
    // arrival. Assume landed only well past schedule (ADS-B missed the arrival).
    return (arr != null && now > arr + 3 * 3600000) ? STATE_COLORS.completed : STATE_COLORS.inflight;
  }
  // No actual departure recorded → fall back to the schedule clock.
  if (dep != null && dep > now) return STATE_COLORS.future;                       // not yet departed
  if (dep != null && arr != null && dep <= now && now < arr) return STATE_COLORS.inflight; // mid-flight by clock
  if (arr != null && arr <= now) return STATE_COLORS.completed;
  return STATE_COLORS.future;
}
// Row geometry — derived top-down so every row is uniform and nothing floats:
//   ┌───────────────────────────┐  y=0
//   │ ······· (13px gap) ······· │
//   │  maintenance band (38px)  │  ← same extent as the actual-flight bar (60% of row, centered)
//   │ ······· (13px gap) ······· │
//   └───────────────────────────┘  y=ROW_H
const ROW_H=64, HDR_H=48, LABEL_W=120;
const MX_AREA_H=Math.round(ROW_H*0.6);         // 38 — matches the actual-flight bar height (60% of row)
const MX_BASE_TOP=Math.round(ROW_H*0.2);       // 13 — matches the actual-flight bar top (centered, 13px gaps)
const MX_LANE_GAP=1;
const MX_MIN_LANE_H=5;                         // floor; thinner lanes collapse into +N more
const MX_MAX_VISIBLE_LANES=Math.max(1, Math.floor((MX_AREA_H+MX_LANE_GAP)/(MX_MIN_LANE_H+MX_LANE_GAP)));
const FLIGHT_TOP=0;                            // flight blocks fill the full row height
const FLIGHT_H=ROW_H;                          // legs span full row (y=0..64) — through the maintenance strip
const DUTY_TOP=FLIGHT_TOP;                     // duty brackets match flight extent
const DUTY_H=FLIGHT_H;
const GROUND_H=ROW_H;                          // ground hatching still fills the row
// Darken a #rrggbb hex by scaling each channel (default 55%) — used for the
// live "in the air" border, which is a darker shade of the block's own color.
const darken = (hex, f=0.55) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex||'');
  if (!m) return hex;
  const n = parseInt(m[1],16);
  const r = Math.round(((n>>16)&255)*f), g = Math.round(((n>>8)&255)*f), b = Math.round((n&255)*f);
  return `#${((1<<24)|(r<<16)|(g<<8)|b).toString(16).slice(1)}`;
};
const floorDay  = ts=>{const d=new Date(ts);d.setHours(0,0,0,0);return d.getTime();};
// The calendar reads in Eastern (operator home base). Flight times are shown in
// ET, with each airport's local time alongside (LevelFlight gives us the airport
// timezone in leg._calc.from/to.timezone) so a near-midnight departure in another
// zone reads correctly — e.g. KMKC 23:30 (Central) shows as 00:30 ET · 23:30 local.
const ET = 'America/New_York';
const fmt = ts=>new Date(ts).toLocaleDateString('en-US',{timeZone:ET,month:'short',day:'numeric',year:'numeric'});
const fmtTime = ms=>ms?new Date(ms).toLocaleString('en-US',{timeZone:ET,month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'—';
const fmtLocal = (ms,tz)=>{ if(!ms||!tz) return null; try { return new Date(ms).toLocaleString('en-US',{timeZone:tz,month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); } catch { return null; } };

// --- Fleet simulation (the "Simulate fleet" toggle) -------------------------
// Builds a dense, realistic 10-aircraft day RELATIVE TO `anchor` (now) so there
// are always completed (blue), in-progress (green ✈, crossing the now-line) and
// planned (grey) legs. Returns data in the REAL leg shape plus matching actuals /
// airborne maps, so it renders through the exact same calendar pipeline. Mock only.
const SIM_EMPTY = { legs: [], actuals: {}, airborne: {} };
const SIM_H = 3600000;
const SIM_CLIENTS = ['Meridian Capital', 'Vantage Group', 'Atlas Holdings', 'Crestline LLC', 'Solaris Partners', null];
// [tail, type, homeBase, [destinations], todaySchedule]
// todaySchedule = [[depHoursFromNow, durationHours, fromICAO, toICAO], ...] — anchored
// to "now" so today always has live in-progress legs. The rest of the week is generated
// as out-and-back trips from the home base. (N69FP intentionally has NO sim flights.)
const SIM_FLEET = [
  ['N408JS', 'Challenger 350', 'KMIA', ['KJAX', 'KATL', 'KTEB', 'KIAD', 'KBOS'],
    [[-6.5, 1.5, 'KMIA', 'KJAX'], [-0.75, 1.75, 'KJAX', 'KATL'], [3, 2, 'KATL', 'KMIA']]],
  ['N512EX', 'Citation X', 'KORL', ['KTPA', 'KDAL', 'KLAS', 'KHOU', 'KMCO'],
    [[-8, 1.5, 'KORL', 'KTPA'], [-4, 3, 'KTPA', 'KDAL'], [1.5, 2.5, 'KDAL', 'KLAS']]],
  ['N727JS', 'G450', 'KIAD', ['KDEN', 'KSEA', 'KSFO', 'KORD', 'KBOS'],
    [[-6, 3, 'KIAD', 'KDEN'], [-0.25, 2.75, 'KDEN', 'KSEA']]],
  ['N880FP', 'Phenom 300', 'KHOU', ['KAUS', 'KSAT', 'KMSY', 'KDAL', 'KDFW'],
    [[-7.5, 1.25, 'KHOU', 'KAUS'], [-5, 1.25, 'KAUS', 'KSAT'], [-2.5, 1.5, 'KSAT', 'KHOU'], [0.5, 1.5, 'KHOU', 'KMSY']]],
  ['N604XJ', 'Challenger 604', 'KBOS', ['KMDW', 'KTEB', 'KDCA', 'KPBI', 'KCLT'],
    [[-2, 2.75, 'KBOS', 'KMDW'], [3, 2, 'KMDW', 'KBOS']]],
  ['N700VP', 'G700', 'KSFO', ['KSAN', 'KLAX', 'KLAS', 'KSEA', 'KJFK'],
    [[-8, 2.5, 'KSFO', 'KSAN'], [-1, 2, 'KSAN', 'KSFO'], [4.5, 2, 'KSFO', 'KLAX']]],
  ['N135LX', 'Learjet 75', 'KFLL', ['KMCO', 'KSAV', 'KCLT', 'KEYW', 'KTLH'],
    [[-7, 1.5, 'KFLL', 'KMCO'], [-4, 1.5, 'KMCO', 'KSAV'], [0.5, 1.5, 'KSAV', 'KCLT']]],
  ['N911EJ', 'Citation CJ4', 'KTMB', ['KEYW', 'KRSW', 'KPBI', 'KSRQ', 'KTLH'],
    [[-8, 1.25, 'KTMB', 'KEYW'], [-6, 1.25, 'KEYW', 'KTMB'], [-1, 1.33, 'KTMB', 'KRSW'], [2, 1.5, 'KRSW', 'KTMB']]],
  ['N350CL', 'Challenger 350', 'KTEB', ['KPBI', 'KBED', 'KMVY', 'KACK', 'KIAD'],
    [[-5, 3, 'KTEB', 'KPBI'], [1.5, 3, 'KPBI', 'KTEB'], [5.5, 1.5, 'KTEB', 'KBED']]],
];
const SIM_DELAYS = [0, 8, -5, 12, 3, -3, 6, -2];
const SIM_BACK_DAYS = 90; // ~3 months of past flights
const SIM_FWD_DAYS = 31;  // only ~1 month of FUTURE flights (no Aug/Sep when "now" is late June)
function buildSimFleet(anchor) {
  const DAY = 86400000;
  const d0 = new Date(anchor); d0.setHours(0, 0, 0, 0); const mid = d0.getTime(); // local midnight today
  const legs = [], actuals = {}, airborne = {};
  let n = 0;
  SIM_FLEET.forEach(([tail, type, home, dests, today], ti) => {
    const add = (key, dep, durH, from, to) => {
      const arr = dep + durH * SIM_H, legId = `sim-${tail}-${key}`;
      const completed = arr <= anchor, inflight = dep <= anchor && anchor < arr;
      const delay = SIM_DELAYS[n % SIM_DELAYS.length] * 60000;
      legs.push({
        _id: { $oid: legId },
        departure: { airport: from, time: dep },
        arrival: { airport: to, time: arr },
        status: completed ? 3 : (inflight ? 1 : 2),
        passengerCount: 2 + ((ti * 3 + n) % 10),
        _calc: { _minutes: Math.round(durH * 60), distance: { value: Math.round(durH * 430) }, from: {}, to: {} },
        dispatch: {
          _id: { $oid: `simd-${tail}-${key}` },
          tripId: 4800 + n,
          aircraft: { tailNumber: tail, type: { name: type } },
          client: { company: { name: SIM_CLIENTS[(ti + n) % SIM_CLIENTS.length] } },
        },
      });
      if (completed) actuals[legId] = { actualDep: dep + delay, actualArr: arr + delay, depSource: 'crew', arrSource: 'crew' };
      else if (inflight) { actuals[legId] = { actualDep: dep + delay, depSource: 'live' }; airborne[tail] = legId; }
      n++;
    };
    // Today — anchored to "now" so there are live in-progress legs crossing the now-line.
    today.forEach(([depH, durH, from, to], i) => add(`today-${i}`, anchor + depH * SIM_H, durH, from, to));
    // Rest of the window — ~3 months back, only ~1 month forward — out-and-back trips
    // from the home base, with ~2 rest days a week so it isn't every single day.
    for (let dOff = -SIM_BACK_DAYS; dOff <= SIM_FWD_DAYS; dOff++) {
      if (dOff === 0) continue;                          // today is the anchored schedule above
      const dow = (((dOff % 7) + 7) % 7);
      if ((dow + ti) % 7 < 2) continue;                  // ~2 rest days/week, varied per tail
      const w = ((ti + dOff) % 4 + 4) % 4;               // deterministic, always 0–3
      let t = mid + dOff * DAY + (7 + w) * SIM_H;        // first push 07:00–10:00
      const obs = 1 + (((ti + dOff) % 2 + 2) % 2);       // 1 or 2 out-and-backs that day
      for (let k = 0; k < obs; k++) {
        const dest = dests[((ti + k + dOff) % dests.length + dests.length) % dests.length];
        const durH = 1.25 + (((ti + k + dOff) % 5 + 5) % 5) * 0.4; // 1.25–2.85h
        add(`${dOff}-${k}a`, t, durH, home, dest);                 // outbound
        t += (durH + 1 + (k % 2) * 0.5) * SIM_H;                   // fly + ground turn
        add(`${dOff}-${k}b`, t, durH, dest, home);                 // return
        t += (durH + 1.5) * SIM_H;
      }
    }
  });
  return { legs, actuals, airborne };
}

export default function Calendar({ legsEndpoint = '/api/levelflight/legs', tripBasePath = null } = {}) {
  const {data,loading}  = useApi(legsEndpoint);
  const {data:dutyData} = useApi('/api/levelflight/duty');
  const {data:maintData} = useApi('/api/maintenance');
  const {positions:live} = useAdsb(20000);  // live ADS-B onGround status per tail
  const navigate = useNavigate();
  const [view,setView]     = useState(() => {
    const saved = localStorage.getItem('exjet.calendar.view');
    return saved && VIEWS[saved] ? saved : 'week';
  });
  useEffect(() => { localStorage.setItem('exjet.calendar.view', view); }, [view]);
  const [offset,setOffset] = useState(() => {
    const s = localStorage.getItem('exjet.calendar.offset');
    return s !== null && !isNaN(+s) ? +s : 0;
  });
  const [zoom,setZoom]     = useState(() => {
    const s = localStorage.getItem('exjet.calendar.zoom');
    return s !== null && +s > 0 ? +s : 1;
  });
  const [autoFit, setAutoFit] = useState(() => localStorage.getItem('exjet.calendar.autoFit') !== 'false');
  useEffect(() => { localStorage.setItem('exjet.calendar.offset', String(offset)); }, [offset]);
  useEffect(() => { localStorage.setItem('exjet.calendar.zoom', String(zoom)); }, [zoom]);
  useEffect(() => { localStorage.setItem('exjet.calendar.autoFit', String(autoFit)); }, [autoFit]);
  const didRestoreScroll = useRef(false);
  const [hovered,setHovered]   = useState(null);
  const [hoverMode,setHoverMode] = useState('sched'); // 'sched' | 'actual' — which block is hovered
  const [tipPos,setTipPos]     = useState({x:0,y:0});
  const [legMenu,setLegMenu]   = useState(null); // {leg,x,y} — leg-click popover (Open / Divert)
  const [divertLeg,setDivertLeg] = useState(null); // leg whose divert modal is open
  const [divertSuggest,setDivertSuggest] = useState(null); // ICAO to prefill (from an ADS-B "looks diverted" alert)
  const [selectedWorkOrder, setSelectedWorkOrder] = useState(null);
  const [sim, setSim] = useState(false); // "Simulate fleet" — preview a busy 10-aircraft day (mock data)
  const [,forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);
  const bodyRef = useRef(null);
  const hdrRef  = useRef(null);
  const dateRef = useRef(null); // continuous views: the day-date strip above the calendar
  const dayFocusRef = useRef(null); // Day view: which day's 00:00 sits at the left edge (null = today)
  const nowLineRef = useRef(null); // continuous now-line overlay (spans header + body)
  const drag    = useRef({on:false,startX:0,scrollX:0,moved:false});

  const cfg = VIEWS[view];
  const continuous = view === 'day' || view === '12h'; // continuous-scroll views

  const SIM = useMemo(() => (sim ? buildSimFleet(Date.now()) : SIM_EMPTY), [sim]);
  const legs = sim ? SIM.legs : (data?.legs || []);

  // Continuous (Day/12h): the timeline spans ALL flights — from the earliest leg's day
  // through the day after the latest leg's — always including today, so nothing is cut off.
  const DAY_MS = 86400000;
  const flightBounds = useMemo(() => {
    let min = Infinity, max = -Infinity;
    for (const l of legs) {
      const dep = l?.departure?.time, arr = l?.arrival?.time;
      if (dep != null) { if (dep < min) min = dep; if (dep > max) max = dep; }
      if (arr != null) { if (arr < min) min = arr; if (arr > max) max = arr; }
    }
    return { min: isFinite(min) ? min : null, max: isFinite(max) ? max : null };
  }, [legs]);
  const todayMid = floorDay(Date.now());
  // Always extend the forward edge to at least 3 months past today, so there's future
  // room to scroll/schedule into even when no flights are booked out there yet.
  const futureMid = (() => { const d = new Date(); d.setHours(0,0,0,0); d.setMonth(d.getMonth() + 3); return d.getTime(); })();
  const contStart = floorDay(Math.min(flightBounds.min ?? todayMid, todayMid));
  const contEnd = floorDay(Math.max(flightBounds.max ?? todayMid, futureMid)) + DAY_MS; // through the later of the last flight / +3mo
  const contSpanDays = Math.max(1, Math.round((contEnd - contStart) / DAY_MS));

  const getRangeStart = useCallback(() => {
    const now = new Date();
    if (view === 'week') {
      const d = new Date(now);
      const day = d.getDay();
      d.setDate(d.getDate() - (day===0?6:day-1));
      d.setHours(0,0,0,0);
      return d.getTime() + offset * 604800000;
    }
    if (view === 'month') {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      return d.getTime();
    }
    return new Date(now.getFullYear() + offset, 0, 1).getTime();
  }, [view, offset]);

  const rangeStart = continuous ? contStart : getRangeStart();

  // Columns that FILL the viewport (drives autoFit): Day fits a 24h day, month fits its
  // day-count, week/year fit cfg.cols. The continuous range itself is far wider (all flights).
  const fitCols = view === 'month'
    ? new Date(new Date(rangeStart).getFullYear(), new Date(rangeStart).getMonth()+1, 0).getDate()
    : cfg.cols;
  const effectiveCols = continuous ? contSpanDays * 24 : fitCols;

  const colW    = Math.max(8, Math.round(cfg.baseColW * zoom));
  const totalMs = effectiveCols * cfg.colMs;
  const totalW  = effectiveCols * colW;
  const rangeEnd = rangeStart + totalMs;

  // Continuous views draw gridlines as a CSS background (per row) instead of
  // ~1,000 DOM nodes × tails, so scrolling/zoom stay smooth: faint hour lines +
  // stronger day lines, plus a single "today" band positioned over today's 24h.
  const dayPx = 24 * colW;
  const gridBg = continuous
    ? `repeating-linear-gradient(to right, rgba(255,255,255,0.13) 0 2px, transparent 2px ${dayPx}px), repeating-linear-gradient(to right, rgba(255,255,255,0.03) 0 1px, transparent 1px ${colW}px)`
    : undefined;
  const todayLeft = continuous ? ((floorDay(Date.now()) - rangeStart) / totalMs) * totalW : 0;

  // Persisted actual dep/arr for legs in view (settled delays); live in-progress
  // delays come from the ADS-B feed below.
  const { actuals: liveActuals, refetch: refetchActuals } = useLegActuals(rangeStart, rangeEnd);
  const actuals = sim ? SIM.actuals : liveActuals;

  const getBlock = (dep,arr) => {
    if (!dep||!arr||arr<rangeStart||dep>rangeEnd) return null;
    const left  = ((Math.max(dep,rangeStart)-rangeStart)/totalMs)*totalW;
    const width = Math.max(((Math.min(arr,rangeEnd)-Math.max(dep,rangeStart))/totalMs)*totalW, 3);
    return {left,width};
  };

  const scrollToCenter = useCallback(() => {
    const el = bodyRef.current; if (!el) return;
    const nowPx = ((Date.now()-rangeStart)/totalMs)*totalW;
    el.scrollLeft = Math.max(0, nowPx - el.clientWidth/2);
  }, [rangeStart,totalMs,totalW]);

  // Continuous views: Prev/Next smooth-scroll by one day instead of reloading a new day.
  const scrollByDay = useCallback((dir) => {
    const el = bodyRef.current; if (!el) return;
    el.scrollBy({ left: dir * 24 * colW, behavior: 'smooth' });
  }, [colW]);
  // Default scroll position: Day view shows one FULL day (today's 00:00 at the left
  // edge); 12h (and Today on other views) centers the now-line.
  const scrollToDefault = useCallback(() => {
    const el = bodyRef.current; if (!el) return;
    if (view === 'day') {
      // Show one full day at the left edge: the focused day (from a drill-down) or today.
      const focus = floorDay(dayFocusRef.current ?? Date.now());
      el.scrollLeft = Math.max(0, ((focus - rangeStart) / totalMs) * totalW);
    } else scrollToCenter();
  }, [view, rangeStart, totalMs, totalW, scrollToCenter]);
  const goToToday = useCallback(() => { dayFocusRef.current = null; if (!continuous) setOffset(0); setTimeout(scrollToDefault,80); }, [scrollToDefault, continuous]);
  // Drill down one level from a clicked header column: Week/Month day -> Day view of
  // that day; Year month -> Month view of that month. Offset mirrors getRangeStart.
  const drillTo = useCallback((targetView, ts) => {
    if (targetView === 'day') {
      // Continuous Day view ignores offset — focus the clicked day and let the
      // continuous scroll effect bring it to the left edge.
      dayFocusRef.current = ts;
      setView('day');
      return;
    }
    setView(targetView);
    setOffset(monthOffsetFromNow(Date.now(), ts));
    setTimeout(() => { if (bodyRef.current) bodyRef.current.scrollLeft = 0; }, 0);
  }, []);
  const calcFitZoom = useCallback(() => {
  if (bodyRef.current) {
    return (bodyRef.current.clientWidth) / (fitCols * cfg.baseColW);
  }
  return 1;
}, [fitCols, cfg.baseColW]);

useEffect(() => {
  if (!autoFit) return;
  setZoom(calcFitZoom());
  const observer = new ResizeObserver(() => setZoom(calcFitZoom()));
  if (bodyRef.current) observer.observe(bodyRef.current);
  return () => observer.disconnect();
}, [autoFit, calcFitZoom, view]);
  // Only center the now bar when the user clicks "Today" — no auto-centering on
  // re-render, zoom change, or the 60s tick. On load, restore the last scroll
  // position once (after autoFit/zoom has settled the layout).
  useEffect(() => {
    if (didRestoreScroll.current || loading) return;
    const el = bodyRef.current; if (!el) return;
    const s = localStorage.getItem('exjet.calendar.scroll');
    const t = setTimeout(() => {
      // Continuous views center the now-bar instead of restoring the saved scroll (handled below).
      if (!continuous && s !== null && !isNaN(+s)) el.scrollLeft = +s;
      didRestoreScroll.current = true;
    }, 160);
    return () => clearTimeout(t);
  }, [loading]);

  // Continuous views (day/12h): keep the now-line in view — center it on load and when
  // the view/zoom changes. now isn't the middle of the span, so center on nowPx (not totalW/2).
  // Not on the 60s tick, so the user's manual scroll is preserved between changes.
  useEffect(() => {
    if (!continuous) return undefined;
    const el = bodyRef.current; if (!el) return undefined;
    const t = setTimeout(() => scrollToDefault(), 80);
    return () => clearTimeout(t);
  }, [continuous, view, totalW, scrollToDefault]);

  const onPD = useCallback(e => {
    const el=bodyRef.current; if(!el) return;
    drag.current={on:true,startX:e.clientX,scrollX:el.scrollLeft,moved:false};
    el.setPointerCapture(e.pointerId); el.style.cursor='grabbing';
  },[]);
  const onPM = useCallback(e => {
    if (!drag.current.on) return;
    const delta=drag.current.startX-e.clientX;
    if (Math.abs(delta)>4) drag.current.moved=true;
    if (bodyRef.current) bodyRef.current.scrollLeft=drag.current.scrollX+delta;
  },[]);
  const onPU = useCallback(() => {
    drag.current.on=false;
    if (bodyRef.current) bodyRef.current.style.cursor='grab';
    setTimeout(()=>{drag.current.moved=false;},150);
  },[]);

  const dutyTimes = dutyData?.dutyTimes||[];

  const acMap={};
  legs.forEach(leg => {
    const tail=leg.dispatch?.aircraft?.tailNumber; if(!tail) return;
    if (!acMap[tail]) acMap[tail]={tail,type:leg.dispatch?.aircraft?.type?.name,legs:[]};
    acMap[tail].legs.push(leg);
  });
  const aircraft=Object.values(acMap).sort((a,b)=>a.tail.localeCompare(b.tail));

  // Lane-assign maintenance/work orders per aircraft so overlapping bars stack
  // instead of colliding. Two events overlap when start_a < end_b && end_a > start_b.
  const maintEvents = Array.isArray(maintData) ? maintData : (maintData?.events || []);
  const maintByTail = {};
  const maintMaxLanes = {};
  maintEvents.forEach(ev => {
    if (!ev?.aircraft_tail || ev.start_time == null || ev.end_time == null) return;
    // Only lane-assign orders that actually fall in the visible window (mirror getBlock's
    // range test). An off-window order (e.g. a past or long-running open one) must NOT
    // inflate the lane count — that was the bug: a lone visible order on a tail with another
    // off-screen order got squished to half-height and pinned to the top lane instead of
    // occupying the full centered band.
    if (ev.end_time < rangeStart || ev.start_time > rangeEnd) return;
    (maintByTail[ev.aircraft_tail] ||= []).push(ev);
  });
  Object.keys(maintByTail).forEach(tail => {
    const sorted = [...maintByTail[tail]].sort((a,b) => a.start_time - b.start_time);
    const laneEnds = []; // laneEnds[i] = end_time of last event placed in lane i
    maintByTail[tail] = sorted.map(ev => {
      let lane = laneEnds.findIndex(end => end <= ev.start_time);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(ev.end_time); }
      else { laneEnds[lane] = ev.end_time; }
      return { ev, lane };
    });
    maintMaxLanes[tail] = laneEnds.length;
  });

  const nowTs  = Date.now();
  const nowPx  = ((nowTs-rangeStart)/totalMs)*totalW;
  const showNow= nowPx>=0&&nowPx<=totalW;
  // Now-bar hover readout: exact Eastern (ops home zone) + UTC/Zulu, e.g. "14:30 EDT · 18:30 UTC".
  const nowEt  = easternParts(new Date(nowTs));
  const nowZ   = zuluParts(new Date(nowTs));
  const hhmmColon = t => `${t.slice(0,2)}:${t.slice(2)}`; // "1430" -> "14:30"
  const nowDetail = nowEt&&nowZ ? `${hhmmColon(nowEt.time)} ${nowEt.zone} · ${hhmmColon(nowZ.time)} UTC` : '';
  // On-screen X of the now-line within the calendar card: body's left edge + content offset − scroll.
  const nowOffsetPx = nowPx - (bodyRef.current?.scrollLeft || 0);
  const nowLineLeft = (bodyRef.current?.offsetLeft ?? LABEL_W) + nowOffsetPx;
  const nowInView   = showNow && nowOffsetPx >= 0 && nowOffsetPx <= (bodyRef.current?.clientWidth ?? Infinity);

  // For each tail ADS-B reports airborne, find the leg it's actually flying:
  // the most-recently-departed leg, tolerating schedule slip (up to 6h past the
  // scheduled arrival). We deliberately do NOT require now <= arrival — that's
  // the unreliable schedule estimate, and a real flight running late would
  // otherwise lose its border the moment it passed its scheduled arrival.
  const LATE_GRACE_MS = 6*3600000;
  const EARLY_DEP_MS = 2*3600000; // an airborne tail can attach to a leg up to 2h before its scheduled dep (early push)
  const airborneLegId = {}; // { tail: leg._id.$oid }
  aircraft.forEach(ac => {
    const la = live[ac.tail];
    if (!la || la.stale || la.onGround !== false) return; // only a CURRENT live fix counts (a stale last-known fix is not "airborne")
    let cur = null;      // most-recently-departed leg (its scheduled dep has already passed)
    let upcoming = null; // soonest leg about to depart — used only when the plane took off EARLY
    ac.legs.forEach(l => {
      const dep=l.departure?.time, arr=l.arrival?.time;
      if (!dep || !arr || nowTs > arr + LATE_GRACE_MS) return;
      if (dep <= nowTs) { if (!cur || dep > cur.departure.time) cur = l; }
      else if (nowTs >= dep - EARLY_DEP_MS) { if (!upcoming || dep < upcoming.departure.time) upcoming = l; }
    });
    const match = cur || upcoming; // prefer an in-progress leg; fall back to an early takeoff
    if (match) airborneLegId[ac.tail] = match._id?.$oid;
  });
  if (sim) Object.assign(airborneLegId, SIM.airborne); // sim has no ADS-B; mark its in-progress legs airborne directly

  const cols = useMemo(() => Array.from({length:effectiveCols},(_,i) => {
    const ts=rangeStart+i*cfg.colMs;
    const d=new Date(ts);
    const isToday=floorDay(ts)===floorDay(Date.now());
    const isMonthStart=d.getDate()===1;
    let label='';
    const isDayStart = (view==='day'||view==='12h') && i>0 && d.getHours()===0; // interior midnight (day boundary)
    // Continuous views: every column is an hour label drawn ON its gridline; the day
    // DATE is rendered in a separate strip above the calendar (below), never inline.
    const isTimeLabel = (view==='day'||view==='12h');
    if (view==='day'||view==='12h') {
      label=`${String(d.getHours()).padStart(2,'0')}:00`; // 24-hour, e.g. "14:00"
    } else if (view==='week') {
      label=`${d.toLocaleDateString('en-US',{weekday:'short'})} ${d.getDate()}`;
    } else if (view==='month') {
      label=String(d.getDate());
    } else {
      label=isMonthStart?d.toLocaleDateString('en-US',{month:'short'}):'';
    }
    return {i,ts,label,isToday,isMonthStart,isDayStart,isTimeLabel,d};
  }), [view, rangeStart, effectiveCols, cfg.colMs]);

  const navBtn=(label,onClick)=>(
    <button onClick={onClick} style={{padding:'7px 12px',fontSize:'13px',background:'var(--bg-card)',color:'var(--text-secondary)',border:'1px solid var(--border)',borderRadius:'7px',cursor:'pointer'}}>{label}</button>
  );

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'14px',width:'100%',maxWidth:'100%',overflow:'hidden',boxSizing:'border-box'}}>

      {/* TOP BAR */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:'10px'}}>
        <div>
          <h1 style={{fontSize:'22px',fontWeight:'600',color:'var(--text-primary)',margin:0}}>Operations Calendar</h1>
          <button
  onClick={() => setAutoFit(a => !a)}
  style={{padding:'0 8px',height:'30px',fontSize:'11px',background: autoFit ? 'var(--accent)' : 'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'6px',cursor:'pointer',color: autoFit ? '#fff' : 'var(--accent)',fontWeight:'600'}}>
  {autoFit ? 'Auto ✓' : 'Auto'}
</button>
<button onClick={()=>setZoom(calcFitZoom())} style={{padding:'0 8px',height:'30px',fontSize:'11px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'6px',cursor:'pointer',color:'var(--accent)',fontWeight:'600'}}>Fit</button>
          <p style={{fontSize:'13px',color:'var(--text-secondary)',marginTop:'3px'}}>
            {loading?'Loading...':`${aircraft.length} aircraft · ${legs.length} legs · ${sim?'SIMULATED — mock data':'same color = same trip'}`}
          </p>
        </div>
        <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
          <div style={{display:'flex',border:'1px solid var(--border)',borderRadius:'8px',overflow:'hidden'}}>
            {Object.entries(VIEWS).map(([k,{label}])=>(
              <button key={k} onClick={()=>{dayFocusRef.current=null;setView(k);setOffset(0);setZoom(1);}} style={{padding:'7px 14px',fontSize:'13px',border:'none',cursor:'pointer',background:view===k?'var(--accent)':'var(--bg-card)',color:view===k?'#fff':'var(--text-secondary)',fontWeight:view===k?'600':'400'}}>{label}</button>
            ))}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
            <button onClick={()=>setZoom(z=>Math.max(0.1,Math.round((z-0.2)*10)/10))} style={{width:'30px',height:'30px',fontSize:'16px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'6px',cursor:'pointer',color:'var(--text-secondary)'}}>−</button>
            <span style={{fontSize:'11px',color:'var(--text-secondary)',minWidth:'34px',textAlign:'center'}}>{Math.round(zoom*100)}%</span>
            <button onClick={()=>setZoom(z=>Math.min(4,Math.round((z+0.2)*10)/10))} style={{width:'30px',height:'30px',fontSize:'16px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'6px',cursor:'pointer',color:'var(--text-secondary)'}}>+</button>
            <button onClick={()=>setZoom((bodyRef.current?.clientWidth||800)/(fitCols*cfg.baseColW))} style={{padding:'0 8px',height:'30px',fontSize:'11px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'6px',cursor:'pointer',color:'var(--accent)',fontWeight:'600'}}>Fit</button>
            <button onClick={()=>setZoom(1)} style={{padding:'0 8px',height:'30px',fontSize:'11px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'6px',cursor:'pointer',color:'var(--text-secondary)'}}>1:1</button>
          </div>
          <button onClick={goToToday} style={{padding:'7px 16px',fontSize:'13px',fontWeight:'600',background:'var(--accent)',color:'#fff',border:'none',borderRadius:'8px',cursor:'pointer'}}>Today</button>
          <button onClick={()=>{const next=!sim;setSim(next);if(next){setView('month');setOffset(0);}}}
            title="Preview a busy fleet — ~3 months back, ~1 month ahead (mock data — does not touch live data)"
            style={{padding:'7px 16px',fontSize:'13px',fontWeight:'600',background:sim?'#a855f7':'var(--bg-card)',color:sim?'#fff':'var(--text-secondary)',border:`1px solid ${sim?'#a855f7':'var(--border)'}`,borderRadius:'8px',cursor:'pointer'}}>
            {sim?'● Simulating':'Simulate fleet'}
          </button>
        </div>
      </div>

      {/* NAV ROW */}
      <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
        {navBtn('← Prev', continuous ? ()=>scrollByDay(-1) : ()=>setOffset(o=>o-1))}
        <span style={{fontSize:'13px',color:'var(--text-secondary)',flex:1,textAlign:'center'}}>{`${fmt(rangeStart)} — ${fmt(rangeEnd)}`}</span>
        {navBtn('Next →', continuous ? ()=>scrollByDay(1) : ()=>setOffset(o=>o+1))}
      </div>

      {/* DAY DATES — a strip above the calendar, each date centered on its day-line
          (continuous views only), scroll-synced with the timeline. */}
      {continuous && (
        <div style={{display:'flex',marginBottom:'-4px'}}>
          <div style={{width:LABEL_W,minWidth:LABEL_W,flexShrink:0}}/>
          <div ref={dateRef} style={{flex:1,overflow:'hidden',minWidth:0}}>
            <div style={{position:'relative',width:totalW,height:18}}>
              {cols.filter(c=>c.d.getHours()===0).map(col=>(
                <span key={col.i} style={{position:'absolute',left:col.i*colW,top:0,transform:'translateX(-50%)',fontSize:'12px',fontWeight:700,color:col.isToday?'var(--accent)':'#dde',whiteSpace:'nowrap',pointerEvents:'none'}}>{col.d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* CALENDAR */}
      <div style={{border:'1px solid var(--border)',borderRadius:'12px',background:'var(--bg-card)',display:'flex',flexDirection:'column',overflow:'visible',width:'100%',boxSizing:'border-box',position:'relative'}}>

        {/* HEADER */}
        <div style={{display:'flex',borderBottom:'2px solid var(--border)',flexShrink:0}}>
          <div style={{width:LABEL_W,minWidth:LABEL_W,height:HDR_H,background:'var(--bg-secondary)',borderRight:'2px solid var(--border)',display:'flex',alignItems:'center',padding:'0 14px',flexShrink:0}}>
            <span style={{fontSize:'11px',fontWeight:'600',color:'var(--text-secondary)',textTransform:'uppercase',letterSpacing:'0.08em'}}>Aircraft</span>
          </div>
          <div style={{flex:1,overflow:'hidden',minWidth:0}}>
            <div ref={hdrRef} style={{overflowX:'hidden',width:'100%'}}>
              <div style={{display:'flex',width:totalW,height:HDR_H,position:'relative',backgroundImage:gridBg}}>
                {/* Header gridlines as absolute divs (same formula as the body) so header
                    and body lines line up exactly; continuous views use the CSS gradient. */}
                {!continuous && cols.map(col=>(
                  <div key={`hg-${col.i}`} style={{position:'absolute',left:col.i*colW,top:0,bottom:0,width:col.isMonthStart||col.isDayStart?2:1,background:col.isMonthStart||col.isDayStart?'rgba(255,255,255,0.13)':'rgba(255,255,255,0.03)',pointerEvents:'none'}}/>
                ))}
                {cols.map(col=>{
                  const daysInThisMonth = view==='year'&&col.isMonthStart
                    ? new Date(col.d.getFullYear(), col.d.getMonth()+1, 0).getDate()
                    : 0;
                  // Non-Day views drill down on click: Year -> Month, Week/Month -> Day.
                  const drillTarget = view==='year' ? 'month' : (view==='day'||view==='12h') ? null : 'day';
                  const baseBg = col.isToday?'rgba(79,142,247,0.12)':'transparent';
                  return (
                    <div key={col.i}
                      onClick={drillTarget ? () => drillTo(drillTarget, col.ts) : undefined}
                      onMouseEnter={drillTarget ? (e)=>{ e.currentTarget.style.background='rgba(79,142,247,0.22)'; } : undefined}
                      onMouseLeave={drillTarget ? (e)=>{ e.currentTarget.style.background=baseBg; } : undefined}
                      title={drillTarget ? (drillTarget==='month'?'Open month':'Open day') : undefined}
                      style={{width:colW,minWidth:colW,height:HDR_H,display:'flex',alignItems:'center',justifyContent:'center',borderRight:'none',background:baseBg,flexShrink:0,overflow:'visible',position:'relative',cursor:drillTarget?'pointer':'default'}}>
                      {view==='year' ? (
                        col.isMonthStart && (
                          <div style={{position:'absolute',left:0,width:daysInThisMonth*colW,height:'100%',display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none',zIndex:2}}>
                            <span style={{fontSize:'12px',fontWeight:'700',color:'#dde',whiteSpace:'nowrap'}}>{col.d.toLocaleDateString('en-US',{month:'long'})}</span>
                          </div>
                        )
                      ) : col.isTimeLabel ? (
                        // Centered ON the gridline (the column's left edge = its actual hour).
                        // Narrow columns (small screens / zoomed out) drop the ":00" so the
                        // numbers don't bunch up — just "14" instead of "14:00".
                        <span style={{position:'absolute',left:0,top:'50%',transform:'translate(-50%,-50%)',fontSize:'12px',fontWeight:col.isToday?'700':'400',color:col.isToday?'var(--accent)':'var(--text-secondary)',whiteSpace:'nowrap',pointerEvents:'none'}}>{colW < 44 ? col.label.slice(0,2) : col.label}</span>
                      ) : (
                        col.label && <span style={{fontSize:view==='month'?'11px':'12px',fontWeight:col.isToday||col.isMonthStart||col.isDayStart?'700':'400',color:col.isToday?'var(--accent)':col.isMonthStart||col.isDayStart?'#dde':'var(--text-secondary)',whiteSpace:'nowrap'}}>{col.label}</span>
                      )}
                    </div>
                  );
                })}
                {/* Now line is drawn once over the whole card (header + body) — see the overlay near the card's end */}
              </div>
            </div>
          </div>
        </div>

        {/* BODY */}
        <div style={{display:'flex',overflow:'hidden',maxHeight:'65vh'}}>
          <div style={{width:LABEL_W,minWidth:LABEL_W,flexShrink:0,borderRight:'2px solid var(--border)',overflowY:'hidden'}} id="lbl-col">
            {aircraft.map((ac,i)=>(
              <div key={ac.tail} style={{height:ROW_H,display:'flex',flexDirection:'column',justifyContent:'center',padding:'0 14px',borderBottom:'1px solid var(--border)',background:i%2===0?'var(--bg-card)':'#111119',flexShrink:0}}>
                <span style={{fontSize:'13px',fontWeight:'700',color:'var(--accent)'}}>{ac.tail}</span>
                <span style={{fontSize:'11px',color:'var(--text-secondary)',marginTop:'3px'}}>{ac.type?.replace('Gulfstream ','G')||'—'}</span>
              </div>
            ))}
          </div>

          <div ref={bodyRef} onPointerDown={onPD} onPointerMove={onPM} onPointerUp={onPU} onPointerCancel={onPU}
            onScroll={e=>{
              if(hdrRef.current)hdrRef.current.scrollLeft=e.target.scrollLeft;
              if(dateRef.current)dateRef.current.scrollLeft=e.target.scrollLeft;
              const lbl=document.getElementById('lbl-col');
              if(lbl)lbl.scrollTop=e.target.scrollTop;
              if(didRestoreScroll.current) localStorage.setItem('exjet.calendar.scroll', String(e.target.scrollLeft));
              // Track the continuous now-line as the body scrolls (no React re-render).
              if(nowLineRef.current){
                const off=nowPx-e.target.scrollLeft;
                const vis=showNow&&off>=0&&off<=e.target.clientWidth;
                nowLineRef.current.style.display=vis?'block':'none';
                nowLineRef.current.style.left=(e.target.offsetLeft+off)+'px';
              }
            }}
            style={{flex:1,minWidth:0,overflowX:'scroll',overflowY:'auto',cursor:'grab'}}>
            <div style={{width:totalW,position:'relative'}}>
              {loading ? (
                <div style={{padding:'60px',textAlign:'center',color:'var(--text-secondary)'}}>Loading...</div>
              ) : aircraft.map((ac,rowIdx)=>(
                <div key={ac.tail} style={{position:'relative',height:ROW_H,borderBottom:'1px solid var(--border)',backgroundColor:rowIdx%2===0?'var(--bg-card)':'#111119',backgroundImage:gridBg}}>

                  {/* Grid lines — CSS background for continuous views (on the row), DOM divs otherwise */}
                  {!continuous && cols.map(col=>(
                    <div key={col.i} style={{position:'absolute',left:col.i*colW,top:0,bottom:0,width:col.isMonthStart||col.isDayStart?2:1,background:col.isMonthStart||col.isDayStart?'rgba(255,255,255,0.13)':'rgba(255,255,255,0.03)',pointerEvents:'none'}}/>
                  ))}

                  {/* Today highlight — a single band for continuous, else per-column */}
                  {continuous
                    ? <div style={{position:'absolute',left:todayLeft,top:0,bottom:0,width:dayPx,background:'rgba(79,142,247,0.05)',pointerEvents:'none'}}/>
                    : cols.filter(c=>c.isToday).map(col=>(
                        <div key={col.i} style={{position:'absolute',left:col.i*colW,top:0,bottom:0,width:colW,background:'rgba(79,142,247,0.05)',pointerEvents:'none'}}/>
                      ))}

                  {/* Now line is drawn ONCE across the whole body (one solid line, no per-row gaps) — see below */}

                  {/* Ground time blocks */}
                  {(()=>{
                    const sorted=[...ac.legs].filter(l=>l.departure?.time&&l.arrival?.time).sort((a,b)=>a.departure.time-b.departure.time);
                    if(!sorted.length) return null;
                    // Ground segments = the gaps BETWEEN consecutive legs, PLUS a trailing
                    // "parked" segment after the LAST leg: the plane stays at its arrival
                    // airport until its next flight (none in view), so it runs to the range's
                    // future edge. Without it, the final parked location showed nothing.
                    // ACTUAL arrival/departure (when known) shifts/shrinks each gap.
                    const segs=[];
                    for(let i=0;i<sorted.length-1;i++){
                      const leg=sorted[i],next=sorted[i+1];
                      const aPrev=actuals[leg._id?.$oid]||{},aNext=actuals[next._id?.$oid]||{};
                      segs.push({gStart:aPrev.actualArr??leg.arrival.time,gEnd:aNext.actualDep??next.departure.time,airport:aPrev.divertedTo||leg.arrival?.airport||'?'});
                    }
                    const last=sorted[sorted.length-1],aLast=actuals[last._id?.$oid]||{};
                    segs.push({gStart:aLast.actualArr??last.arrival.time,gEnd:rangeEnd,airport:aLast.divertedTo||last.arrival?.airport||'?',parked:true});
                    return segs.map((s,i)=>{
                      if(s.gEnd-s.gStart<600000) return null;
                      const blk=getBlock(s.gStart,s.gEnd); if(!blk) return null;
                      const airport=s.airport;
                      const gMins=Math.round((s.gEnd-s.gStart)/60000);
                      // Parked blocks run to an arbitrary future edge — show no bogus total on the
                      // bar; the tooltip reports how long it's been on the ground instead.
                      const durLabel=s.parked?null:(gMins>=60?`${Math.floor(gMins/60)}h ${gMins%60}m`:`${gMins}m`);
                      const parkedMins=Math.max(0,Math.round((Date.now()-s.gStart)/60000));
                      const parkedLabel=parkedMins>=60?`${Math.floor(parkedMins/60)}h ${parkedMins%60}m on ground`:`${parkedMins}m on ground`;
                      return(
                        <div key={`g-${i}`}
                          onMouseEnter={e=>{setHovered({_isGround:true,airport,duration:s.parked?parkedLabel:durLabel,start:s.gStart,end:s.parked?null:s.gEnd,parked:!!s.parked});setTipPos({x:e.clientX,y:e.clientY});}}
                          onMouseMove={e=>setTipPos({x:e.clientX,y:e.clientY})}
                          onMouseLeave={()=>setHovered(null)}
                          style={{position:'absolute',left:blk.left,top:0,width:blk.width,height:GROUND_H,background:'repeating-linear-gradient(45deg,rgba(255,255,255,0.025) 0px,rgba(255,255,255,0.025) 4px,transparent 4px,transparent 10px)',borderLeft:'1px solid rgba(255,255,255,0.08)',borderRight:'1px solid rgba(255,255,255,0.08)',zIndex:1,cursor:'default'}}>
                          {blk.width>50&&(
                            // Sticky so the airport rides along and stays visible no matter how wide
                            // the block is (a long sit, or the parked tail running to the future edge).
                            <div style={{position:'sticky',left:6,width:'fit-content',height:'100%',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:'1px',pointerEvents:'none'}}>
                              <span style={{fontSize:'10px',fontWeight:'700',color:'rgba(255,255,255,0.4)',whiteSpace:'nowrap'}}>{airport}</span>
                              {blk.width>90&&durLabel&&<span style={{fontSize:'9px',color:'rgba(255,255,255,0.25)',whiteSpace:'nowrap'}}>{durLabel}</span>}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                  {/* Maintenance blocks — lane-assigned, shrunk to share the fixed strip */}
                  {(() => {
                    const items = maintByTail[ac.tail] || [];
                    if (items.length === 0) return null;
                    const totalLanes   = maintMaxLanes[ac.tail] || 1;
                    const visibleLanes = Math.min(totalLanes, MX_MAX_VISIBLE_LANES);
                    // Every case divides the full band evenly. 1 lane = a block the same size as the
                    // actual-flight bar — 60% of the row, centered (MX_BASE_TOP = round(ROW_H*0.2)).
                    const laneH        = (MX_AREA_H - (visibleLanes - 1) * MX_LANE_GAP) / visibleLanes;
                    // Always show the title; scale font down so it still fits in thin stacked lanes.
                    const fontSize     = laneH >= 14 ? 10 : laneH >= 11 ? 9 : laneH >= 8 ? 8 : 7;
                    const showText     = laneH >= 5;
                    const overflowTop  = MX_BASE_TOP + (visibleLanes - 1) * (laneH + MX_LANE_GAP);

                    return items.map(({ ev, lane }, mi) => {
                      const blk = getBlock(ev.start_time, ev.end_time);
                      if (!blk) return null;
                      const isMx     = ev.type === 'maintenance';
                      const isDown   = ev.type === 'aog';
                      const handlers = {
                        // stop pointer capture by the row drag handler — otherwise it eats the click
                        onPointerDown: e => e.stopPropagation(),
                        onMouseEnter: e => { setHovered({ _isMaint: true, title: ev.title, type: ev.type, tail: ev.aircraft_tail, notes: ev.notes, start: ev.start_time, end: ev.end_time }); setTipPos({ x: e.clientX, y: e.clientY }); },
                        onMouseMove:  e => setTipPos({ x: e.clientX, y: e.clientY }),
                        onMouseLeave: () => setHovered(null),
                        onClick:      e => { e.stopPropagation(); setSelectedWorkOrder(ev); },
                      };

                      // Overflow: this lane would be too thin — collapse into a "+1 more" pill in the bottom visible slot.
                      if (lane >= visibleLanes) {
                        return (
                          <div key={`mx-of-${mi}`} {...handlers}
                            style={{ position: 'absolute', left: blk.left, top: overflowTop, width: Math.min(blk.width, 36), height: laneH, background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.35)', borderRadius: '2px', zIndex: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: `${Math.min(fontSize, 9)}px`, fontWeight: 700, color: '#fff', lineHeight: 1, cursor: 'pointer', overflow: 'hidden' }}>
                            +1
                          </div>
                        );
                      }

                      const bgColor     = isDown ? 'rgba(239, 68, 68, 0.15)' : isMx ? 'rgba(245,158,11,0.15)' : 'rgba(168,85,247,0.15)';
                      const borderColor = isDown ? '#ef4444' : isMx ? '#f59e0b' : '#a855f7';
                      const top         = MX_BASE_TOP + lane * (laneH + MX_LANE_GAP);

                      return (
                        <div key={`mx-${mi}`} {...handlers}
                          style={{ position: 'absolute', left: blk.left, top, width: blk.width, height: laneH, background: bgColor, border: `1px solid ${borderColor}`, borderRadius: '5px', boxSizing: 'border-box', zIndex: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'pointer', lineHeight: 1 }}>
                          {showText && blk.width > 40 && (
                            <span style={{ fontSize: `${fontSize}px`, fontWeight: 700, color: borderColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 4px', display: 'block', maxWidth: '100%' }}>
                              {isDown ? '⛔' : '🔧'} {blk.width > 80 ? ev.title : ''}
                            </span>
                          )}
                        </div>
                      );
                    });
                  })()}
                  {/* Duty brackets — open duties (only one of out/in set) render too */}
                  {(()=>{
                    const DUTY_LIMIT_MS=14*3600000;
                    // Open duty: one of out/in is null/0/missing. Use whichever
                    // is a valid positive timestamp as the start; effective end
                    // is start+14h (Part 135 ceiling). Closed duties keep their
                    // original [min(out,in), max(out,in)] window.
                    const info=d=>{
                      const o=Number.isFinite(d.out)&&d.out>0?d.out:null;
                      const i=Number.isFinite(d.in)&&d.in>0?d.in:null;
                      if(o==null&&i==null) return null;
                      const open=o==null||i==null;
                      const start=open?(o??i):Math.min(o,i);
                      const end=open?start+DUTY_LIMIT_MS:Math.max(o,i);
                      return {start,end,open};
                    };
                    const type11=dutyTimes.flatMap(d=>{
                      if(d.type!==11) return [];
                      const inf=info(d);
                      if(!inf) return [];
                      const userId=d.user?.$oid||d.user;
                      // Attribute the duty to THIS aircraft only when its pilot actually
                      // crews a time-overlapping leg OF THIS tail — not merely any leg in the
                      // same time window (that cross-contaminated the two tails' duties).
                      const matches=ac.legs.some(leg=>
                        leg.departure?.time&&leg.arrival?.time
                        &&inf.start<=leg.arrival.time+7200000&&inf.end>=leg.departure.time-7200000
                        &&(leg.pilots||[]).some(p=>(p.user?._id?.$oid||p.user)===userId));
                      return matches?[{...d,_start:inf.start,_end:inf.end,_open:inf.open}]:[];
                    });
                    const dutyWithRole=type11.map(d=>{
                      const userId=d.user?.$oid||d.user;
                      let role='UNKNOWN';
                      for(const leg of ac.legs){
                        const pilot=(leg.pilots||[]).find(p=>(p.user?._id?.$oid||p.user)===userId);
                        if(pilot){role=pilot.seat===2?'PIC':'SIC';break;}
                      }
                      return {...d,role};
                    });
                    // Crew duties starting within 15 min of each other share one
                    // bracket (one START marker); >15 min apart → separate brackets
                    // so the SIC's distinct duty start shows too.
                    const groups=groupDutiesByStart(dutyWithRole,15*60000);
                    return groups.map((group,gi)=>{
                      const earliest=Math.min(...group.map(d=>d._start));
                      // While ANY duty in the group is still open, the second
                      // bracket is the projected 14h Part 135 ceiling. Once all
                      // duties are submitted, switch to the actual logged end —
                      // no 14h math, no countdown.
                      const groupOpen=group.some(d=>d._open);
                      const groupEnd=groupOpen?earliest+DUTY_LIMIT_MS:Math.max(...group.map(d=>d._end));
                      const startBlk=getBlock(earliest,earliest+1);
                      const endBlk=getBlock(groupEnd,groupEnd+1);
                      const onDutyMins=Math.max(0,Math.round((Date.now()-earliest)/60000));
                      const totalMins=Math.max(0,Math.round((groupEnd-earliest)/60000));
                      const onDutyLabel=`${Math.floor(onDutyMins/60)}h ${onDutyMins%60}m on duty`;
                      const totalLabel=`${Math.floor(totalMins/60)}h ${totalMins%60}m total`;
                      const timeRemaining=Math.max(0,Math.round((groupEnd-Date.now())/60000));
                      const remainingLabel=timeRemaining>0?`${Math.floor(timeRemaining/60)}h ${timeRemaining%60}m remaining`:'DUTY LIMIT REACHED';
                      const lineColor=groupOpen
                        ?(timeRemaining<120?'#ef4444':timeRemaining<240?'#f59e0b':'#4f8ef7')
                        :'#4f8ef7';
                      const hasPIC=group.some(d=>d.role==='PIC');
                      const hasSIC=group.some(d=>d.role==='SIC');
                      const noRole=!hasPIC&&!hasSIC; // unknown crew → keep the bottom bar so it stays visible
                      // Top bar = PIC, bottom bar = SIC; a grouped PIC+SIC shows both.
                      const topBar=hasPIC, bottomBar=hasSIC||noRole;
                      const members=group.map(d=>({role:d.role,start:d._start,end:d._end}));
                      const startDuration=groupOpen?onDutyLabel:totalLabel;
                      const startLimit=groupOpen?remainingLabel:'';
                      const endLabel=groupOpen?'14hr Limit':`Flight Duty OFF · ${totalLabel}`;
                      const endLimit=groupOpen?remainingLabel:'';
                      const endTriangleColor=groupOpen?'#ef4444':lineColor;
                      return(
                        <React.Fragment key={`dg-${gi}`}>
                          {startBlk&&(
                            <div onMouseEnter={e=>{setHovered({_isDuty:true,label:'Flight Duty START',time:earliest,duration:startDuration,limit:startLimit,tail:ac.tail,members,which:'start'});setTipPos({x:e.clientX,y:e.clientY});}} onMouseMove={e=>setTipPos({x:e.clientX,y:e.clientY})} onMouseLeave={()=>setHovered(null)}
                              style={{position:'absolute',left:startBlk.left-1,top:DUTY_TOP,width:16,height:DUTY_H,zIndex:6,cursor:'default',pointerEvents:'auto'}}>
                              <div style={{position:'absolute',left:0,top:0,width:2,height:'100%',background:lineColor,opacity:0.9}}/>
                              {topBar&&<div style={{position:'absolute',left:0,top:0,width:10,height:2,background:lineColor,opacity:0.9}}/>}
                              {bottomBar&&<div style={{position:'absolute',left:0,bottom:0,width:10,height:2,background:lineColor,opacity:0.9}}/>}
                              <div style={{position:'absolute',left:3,top:'50%',transform:'translateY(-50%)',fontSize:'10px',color:'#22c55e',fontWeight:'700',lineHeight:1}}>▶</div>
                            </div>
                          )}
                          {endBlk&&(
                            <div onMouseEnter={e=>{setHovered({_isDuty:true,label:endLabel,time:groupEnd,duration:startDuration,limit:endLimit,tail:ac.tail,isLimit:groupOpen,members,which:'end'});setTipPos({x:e.clientX,y:e.clientY});}} onMouseMove={e=>setTipPos({x:e.clientX,y:e.clientY})} onMouseLeave={()=>setHovered(null)}
                              style={{position:'absolute',left:endBlk.left-1,top:DUTY_TOP,width:16,height:DUTY_H,zIndex:6,cursor:'default',pointerEvents:'auto'}}>
                              <div style={{position:'absolute',right:0,top:0,width:2,height:'100%',background:lineColor,opacity:0.9}}/>
                              {topBar&&<div style={{position:'absolute',right:0,top:0,width:10,height:2,background:lineColor,opacity:0.9}}/>}
                              {bottomBar&&<div style={{position:'absolute',right:0,bottom:0,width:10,height:2,background:lineColor,opacity:0.9}}/>}
                              <div style={{position:'absolute',right:3,top:'50%',transform:'translateY(-50%)',fontSize:'10px',color:endTriangleColor,fontWeight:'700',lineHeight:1}}>◀</div>
                            </div>
                          )}
                        </React.Fragment>
                      );
                    });
                  })()}

                  {/* Leg blocks */}
                  {ac.legs.map((leg,li)=>{
                    const dep=leg.departure?.time, arr=leg.arrival?.time;
                    const blk=getBlock(dep,arr); if(!blk) return null;
                    const isHov=hovered?._id?.$oid===leg._id?.$oid;
                    const dest=leg.arrival?.airport||'';
                    const origin=leg.departure?.airport||'';
                    // Live "in the air": this leg is the one the airborne tail is flying
                    // (most-recently-departed leg, tolerating schedule slip — see airborneLegId).
                    const isAirborne=!!leg._id?.$oid&&airborneLegId[ac.tail]===leg._id?.$oid;
                    const legId=leg._id?.$oid;
                    const act=(legId&&actuals[legId])||{};
                    const la=live[ac.tail];
                    // Block colour by flight STATE: completed=blue, in-flight=green, future=grey.
                    const color=legStateColor(leg,isAirborne,act,nowTs);
                    const darker=darken(color);
                    // Scheduled flight = transparent outer block (the whole planned span);
                    // actual flight = solid inner block, same colour, nested inside; trip #
                    // labels the actual block. No red/green — the offset shows the delay.
                    // Actual-flight bar. Start = recorded actual_dep, else the live wheels-up
                    // time, else (airborne but we picked it up mid-air with no wheels-up) the
                    // scheduled departure as a placeholder — so the bar still appears the moment
                    // ADS-B confirms the flight is airborne, and grows with the now-bar.
                    // Start = recorded actual_dep; else the live wheels-up; else (airborne mid-air
                    // pickup, OR landed with an arrival but no captured takeoff) the scheduled departure.
                    const aStart=act.actualDep??(isAirborne?(la?.airborneSinceMs??dep):(arrShown(act.actualDep,act.actualArr)?dep:null));
                    // Bar end: a shown arrival (corrupt arr<=dep ignored); else, while airborne,
                    // it grows with the now-bar; else if it has DEPARTED but we never captured the
                    // landing (ADS-B lost it near the ground — arr backfills hourly), fall back to
                    // the scheduled arrival so the bar doesn't vanish on landing.
                    const aEnd=arrShown(act.actualDep,act.actualArr)?act.actualArr
                      :isAirborne?nowTs
                      :(act.actualDep!=null&&arr!=null&&arr>act.actualDep)?arr
                      :null;
                    const actBlk=(aStart!=null&&aEnd!=null&&aEnd>aStart)?getBlock(aStart,aEnd):null;
                    // Departed but NOT confirmed landed (no actual arrival, not airborne) → the bar
                    // is only an ESTIMATE to the scheduled arrival. Render it dashed/amber
                    // "unconfirmed" so a coverage gap — or a diversion — isn't shown as a normal
                    // completed flight (until the arrival backfills or a dispatcher marks a divert).
                    const unconfirmed=actBlk!=null&&act.actualDep!=null&&!isAirborne&&!arrShown(act.actualDep,act.actualArr);
                    const diverted=!!act.divertedTo; // dispatcher marked it landed elsewhere
                    // ADS-B "looks diverted": departed, not confirmed landed, not already
                    // marked, and the last-known (stale) fix's nearest airport ≠ scheduled arrival.
                    const possibleDivert=unconfirmed&&!diverted&&la?.stale&&la.nearestIcao&&la.nearestIcao!==leg.arrival?.airport;
                    const open=e=>{e.stopPropagation();tripBasePath?navigate(`${tripBasePath}/${leg.dispatch?._id?.$oid}`):navigate(`/flights/${leg._id?.$oid}`,{state:{leg}});};
                    const legClick=e=>{e.stopPropagation();setLegMenu({leg,x:e.clientX,y:e.clientY});};
                    // hov/hovA fire on BOTH enter and move, so the tooltip mode always tracks
                    // whichever block is under the cursor (switch through them freely).
                    const hov=e=>{setHovered(leg);setHoverMode('sched');setTipPos({x:e.clientX,y:e.clientY});};
                    const hovA=e=>{setHovered(leg);setHoverMode('actual');setTipPos({x:e.clientX,y:e.clientY});};
                    return(
                      <React.Fragment key={legId||li}>
                        {/* Scheduled flight — transparent, covers the whole planned span */}
                        <div onPointerDown={e=>e.stopPropagation()} onClick={legClick} onMouseEnter={hov} onMouseMove={hov} onMouseLeave={()=>setHovered(null)}
                          style={{position:'absolute',left:blk.left+1,top:FLIGHT_TOP,width:Math.max(blk.width-2,3),height:FLIGHT_H,background:`${color}33`,border:`1px solid ${color}99`,borderRadius:'5px',cursor:'pointer',boxShadow:isHov?`0 2px 12px ${color}66`:'none',zIndex:isHov?5:2,boxSizing:'border-box'}}/>
                        {/* Actual flight — solid bar at 60% height, vertically centred. Always ABOVE
                            the scheduled block (even when hovered) so it can be hovered directly. */}
                        {actBlk&&<div onPointerDown={e=>e.stopPropagation()} onClick={legClick} onMouseEnter={hovA} onMouseMove={hovA} onMouseLeave={()=>setHovered(null)}
                          style={{position:'absolute',left:actBlk.left+1,top:FLIGHT_TOP+Math.round(FLIGHT_H*0.2),width:Math.max(actBlk.width-2,3),height:Math.round(FLIGHT_H*0.6),background:diverted?'rgba(239,68,68,0.28)':(unconfirmed?'rgba(245,158,11,0.18)':color),borderRadius:'4px',cursor:'pointer',border:diverted?'1.5px solid #ef4444':(unconfirmed?'1.5px dashed #f59e0b':(isAirborne?`2px solid ${darker}`:'none')),...(isAirborne&&!diverted?{'--ab':darker,animation:'exjetAirbornePulse 1.6s ease-in-out infinite'}:null),zIndex:isHov?8:(isAirborne?7:4),boxSizing:'border-box'}}/>}
                        {/* Route, centred in the solid actual bar (or the scheduled block if not yet flown) */}
                        {(()=>{
                          const lb=actBlk||blk; if(lb.width<40) return null;
                          const onBar=!!actBlk;
                          return <div style={{position:'absolute',left:lb.left+1,top:onBar?FLIGHT_TOP+Math.round(FLIGHT_H*0.2):FLIGHT_TOP,width:Math.max(lb.width-2,3),height:onBar?Math.round(FLIGHT_H*0.6):FLIGHT_H,zIndex:9,pointerEvents:'none',display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden',padding:'0 4px'}}>
                            <span style={{fontSize:'10px',fontWeight:'600',color:'#fff',whiteSpace:'nowrap',textShadow:'0 1px 1px rgba(0,0,0,0.35)'}}>{diverted?`⤳ ${act.divertedTo}`:`${origin}→${dest}`}</span>
                          </div>;
                        })()}
                        {/* ADS-B "looks diverted" alert — click to mark (modal prefilled with the nearby airport) */}
                        {possibleDivert&&actBlk&&<div onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();setDivertSuggest(la.nearestIcao);setDivertLeg(leg);}} title={`Last seen near ${la.nearestIcao}, not ${leg.arrival?.airport} — possible diversion. Click to mark.`}
                          style={{position:'absolute',left:actBlk.left+1,top:FLIGHT_TOP-9,zIndex:11,fontSize:'9px',fontWeight:'700',color:'#1a1a1a',background:'#f59e0b',borderRadius:'3px',padding:'0 4px',cursor:'pointer',whiteSpace:'nowrap',boxShadow:'0 1px 3px rgba(0,0,0,0.45)'}}>⚠ {la.nearestIcao}?</div>}
                        {/* Live in-flight: plane just to the RIGHT of the now-bar, leading the growing actual bar */}
                        {actBlk&&isAirborne&&act.actualArr==null&&<div style={{position:'absolute',left:nowPx+3,top:FLIGHT_TOP+Math.round(FLIGHT_H*0.5)-11,zIndex:10,pointerEvents:'none',fontSize:'22px',lineHeight:1,color:'#22c55e',textShadow:'0 0 6px rgba(0,0,0,0.9)'}}>✈</div>}
                      </React.Fragment>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Now line — ONE element over the whole card (header + body) so it's a single solid line with
            no header/body seam. Positioned imperatively on scroll (left = LABEL_W + nowPx − scrollLeft). */}
        {!loading&&showNow&&(
          <div ref={nowLineRef} style={{position:'absolute',top:0,bottom:0,width:2,left:nowLineLeft,display:nowInView?'block':'none',background:'var(--danger)',boxShadow:'0 0 6px rgba(239,68,68,0.5)',zIndex:7,pointerEvents:'none'}}>
            {/* NOW pill: always shows the exact EST/UTC time, centered on the now-line, RESTING ON TOP of the calendar (above the top edge). */}
            <div
              style={{position:'absolute',top:-16,left:'50%',transform:'translateX(-50%)',background:'var(--danger)',borderRadius:'3px',padding:'2px 6px',fontSize:'10px',color:'#fff',fontWeight:'700',whiteSpace:'nowrap',boxShadow:'0 1px 3px rgba(0,0,0,0.4)',pointerEvents:'none',cursor:'default'}}>
              {nowDetail || 'NOW'}
            </div>
          </div>
        )}
      </div>

      {/* TOOLTIP */}
      
      {hovered&&(
        
        <div style={{position:'fixed',left:Math.min(tipPos.x+16,window.innerWidth-260),top:Math.min(tipPos.y-8,window.innerHeight-260),background:'var(--bg-secondary)',border:'1px solid var(--border)',borderRadius:'10px',padding:'14px 16px',zIndex:9999,boxShadow:'0 8px 32px rgba(0,0,0,.6)',pointerEvents:'none',width:'240px'}}>
          {hovered._isMaint ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: hovered.type==='aog'?'#ef4444':'#f59e0b' }} />
                <p style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)', margin: 0 }}>{hovered.title}</p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>Aircraft: {hovered.tail}</p>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>Type: {hovered.type}</p>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>From: {fmtTime(hovered.start)}</p>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>Until: {fmtTime(hovered.end)}</p>
                {hovered.notes && <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>Notes: {hovered.notes}</p>}
              </div>
            </>
          ) : hovered._isDuty ? (
            <>
              <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'10px'}}>
                <div style={{width:'10px',height:'10px',borderRadius:'2px',background:hovered.isLimit?'#ef4444':'#22c55e'}}/>
                <p style={{fontSize:'14px',fontWeight:'700',color:'var(--text-primary)',margin:0}}>{hovered.label}</p>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
                <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>Aircraft: {hovered.tail}</p>
                {hovered.members?.length
                  ? hovered.members.map((m,i)=>(<p key={i} style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>{m.role}: {fmtTime(hovered.which==='end'?m.end:m.start)}</p>))
                  : <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>Time: {fmtTime(hovered.time)}</p>}
                <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>{hovered.duration}</p>
                {hovered.limit && <p style={{fontSize:'12px',fontWeight:'600',color:hovered.limit?.includes('REACHED')?'var(--danger)':'#f59e0b',margin:0}}>{hovered.limit}</p>}
              </div>
            </>
          ):hovered._isGround?(
            <>
              <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'10px'}}>
                <div style={{width:'10px',height:'10px',borderRadius:'2px',background:'rgba(255,255,255,0.2)',border:'1px solid rgba(255,255,255,0.3)'}}/>
                <p style={{fontSize:'14px',fontWeight:'700',color:'var(--text-primary)',margin:0}}>{hovered.parked?'Parked':'On Ground'} · {hovered.airport}</p>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
                {hovered.duration&&<p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>{hovered.parked?'':'Duration: '}{hovered.duration}</p>}
                <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>{hovered.parked?'Since':'From'}: {fmtTime(hovered.start)}</p>
                {!hovered.parked&&<p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>Until: {fmtTime(hovered.end)}</p>}
              </div>
            </>
          ):(
            <>
              <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'10px'}}>
                <div style={{width:'10px',height:'10px',borderRadius:'2px',background:legStateColor(hovered,Object.values(airborneLegId).includes(hovered._id?.$oid),actuals[hovered._id?.$oid],nowTs),flexShrink:0}}/>
                <p style={{fontSize:'14px',fontWeight:'700',color:'var(--text-primary)',margin:0}}>{hovered.departure?.airport} → {hovered.arrival?.airport}</p>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:'5px'}}>
                <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>✈ {hovered.dispatch?.aircraft?.tailNumber} · Trip #{hovered.dispatch?.tripId}</p>
                {(()=>{
                  const dep=hovered.departure?.time, arr=hovered.arrival?.time;
                  const a=actuals[hovered._id?.$oid]||{};
                  const hasActual=a.actualDep!=null||a.actualArr!=null;
                  // Hovering the actual (solid) block shows actual times; the scheduled
                  // (transparent) block — or no actuals — shows scheduled times.
                  if(hoverMode==='actual'&&hasActual){
                    const line=(label,act,sch,src)=>{
                      if(act==null) return <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>{label}: —</p>;
                      const m=sch!=null?Math.round((act-sch)/60000):null;
                      const col=m>=5?'#ef4444':(m<=-5?'#22c55e':'var(--text-secondary)');
                      const lbl=m==null?'':(Math.abs(m)<5?' · on time':(m>0?` · ${m} min late`:` · ${-m} min early`));
                      const srcLbl=src==='crew'?' · pilot':src==='approx'?' · ADS-B est':src?' · ADS-B':'';
                      return <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>{label}: {fmtTime(act)} ET<span style={{color:col,fontWeight:'600'}}>{lbl}</span><span style={{color:'var(--text-secondary)',opacity:.7}}>{srcLbl}</span></p>;
                    };
                    return (<>
                      <p style={{fontSize:'11px',fontWeight:'700',color:'#9ec1f5',letterSpacing:'.5px',margin:'2px 0 0'}}>ACTUAL FLIGHT</p>
                      {line('Dep',a.actualDep,dep,a.depSource)}
                      {line('Arr',a.actualArr,arr,a.arrSource)}
                    </>);
                  }
                  if(hoverMode==='actual'){
                    // Airborne live but no recorded actual yet (we picked it up mid-air).
                    const lp=live[hovered.dispatch?.aircraft?.tailNumber];
                    if(lp&&lp.onGround===false){
                      return (<>
                        <p style={{fontSize:'11px',fontWeight:'700',color:'#9ec1f5',letterSpacing:'.5px',margin:'2px 0 0'}}>ACTUAL · LIVE</p>
                        <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>Airborne now{lp.altitudeFt!=null?` · ${lp.altitudeFt.toLocaleString()} ft`:''}{lp.groundSpeedKt!=null?` · ${Math.round(lp.groundSpeedKt)} kt`:''}</p>
                        <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>Exact departure time pending</p>
                      </>);
                    }
                  }
                  const fromTz=hovered._calc?.from?.timezone, toTz=hovered._calc?.to?.timezone;
                  const depLocal=fmtLocal(dep,fromTz), arrLocal=fmtLocal(arr,toTz);
                  return (<>
                    <p style={{fontSize:'11px',fontWeight:'700',color:'var(--text-secondary)',letterSpacing:'.5px',margin:'2px 0 0'}}>SCHEDULED</p>
                    <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>Dep {hovered.departure?.airport}: {fmtTime(dep)} ET{depLocal&&fromTz!==ET?` · ${depLocal} local`:''}</p>
                    <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>Arr {hovered.arrival?.airport}: {fmtTime(arr)} ET{arrLocal&&toTz!==ET?` · ${arrLocal} local`:''}</p>
                  </>);
                })()}
                {hovered._calc?._minutes>0&&<p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>{Math.floor(hovered._calc._minutes/60)}h {hovered._calc._minutes%60}m · {hovered._calc?.distance?.value||'—'} nm</p>}
                <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>{hovered.dispatch?.client?.company?.name||'No client'}</p>
                <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>Pax: {hovered.passengerCount||0}</p>
              </div>
              <div style={{paddingTop:'10px',marginTop:'6px',borderTop:'1px solid var(--border)',display:'flex',justifyContent:'space-between'}}>
                <span style={{fontSize:'11px',color:'var(--text-secondary)'}}>{STATUS[hovered.status]?.label||'Unknown'}</span>
                <span style={{fontSize:'11px',color:'var(--text-secondary)'}}>Click to open →</span>
              </div>
            </>
          )}
        </div>
      )}
      {selectedWorkOrder && (
  <div onClick={() => setSelectedWorkOrder(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '28px', width: '420px', maxWidth: '90vw' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <p style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: '700', margin: '0 0 4px' }}>WORK ORDER</p>
          <h2 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text-primary)', margin: 0 }}>{selectedWorkOrder.title}</h2>
        </div>
        <button onClick={() => setSelectedWorkOrder(null)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '20px', cursor: 'pointer' }}>✕</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Aircraft</span>
          <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--accent)' }}>{selectedWorkOrder.aircraft_tail}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Airport</span>
          <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>{selectedWorkOrder.airport || '—'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Start</span>
          <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>{new Date(selectedWorkOrder.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Est. Completion</span>
          <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>{selectedWorkOrder.end_time ? new Date(selectedWorkOrder.end_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Status</span>
          <span style={{ fontSize: '13px', fontWeight: '600', color: selectedWorkOrder.completed ? '#22c55e' : '#f59e0b' }}>{selectedWorkOrder.completed ? 'Completed' : 'In Progress'}</span>
        </div>
        {selectedWorkOrder.notes && (
          <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Notes</span>
            <p style={{ fontSize: '13px', color: 'var(--text-primary)', margin: '4px 0 0' }}>{selectedWorkOrder.notes}</p>
          </div>
        )}
      </div>
    </div>
  </div>
)}
      {/* Leg click → small popover: Open (navigate) or Mark diverted */}
      {legMenu && (
        <>
          <div onClick={()=>setLegMenu(null)} style={{position:'fixed',inset:0,zIndex:9998}}/>
          <div style={{position:'fixed',left:Math.min(legMenu.x,window.innerWidth-170),top:legMenu.y+8,zIndex:9999,background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'8px',boxShadow:'0 8px 24px rgba(0,0,0,0.5)',overflow:'hidden',minWidth:'150px'}}>
            <button onClick={()=>{const l=legMenu.leg;setLegMenu(null);tripBasePath?navigate(`${tripBasePath}/${l.dispatch?._id?.$oid}`):navigate(`/flights/${l._id?.$oid}`,{state:{leg:l}});}} style={{display:'block',width:'100%',textAlign:'left',padding:'9px 14px',background:'transparent',border:'none',color:'var(--text-primary)',fontSize:'13px',cursor:'pointer'}}>Open</button>
            <button onClick={()=>{setDivertSuggest(null);setDivertLeg(legMenu.leg);setLegMenu(null);}} style={{display:'block',width:'100%',textAlign:'left',padding:'9px 14px',background:'transparent',border:'none',borderTop:'1px solid var(--border)',color:actuals[legMenu.leg?._id?.$oid]?.divertedTo?'#ef4444':'#f59e0b',fontSize:'13px',cursor:'pointer'}}>{actuals[legMenu.leg?._id?.$oid]?.divertedTo?'⚠ Edit / remove diversion':'⚠ Mark diverted'}</button>
          </div>
        </>
      )}
      {divertLeg && <DivertModal leg={divertLeg} currentDivert={actuals[divertLeg?._id?.$oid]?.divertedTo||null} suggestedIcao={divertSuggest} onClose={()=>{setDivertLeg(null);setDivertSuggest(null);}} onSaved={()=>{ if(refetchActuals) refetchActuals(); }} />}
      <style>{`
        @keyframes exjetAirbornePulse {
          0%, 100% { box-shadow: 0 0 2px 0 var(--ab); }
          50%      { box-shadow: 0 0 8px 2px var(--ab); }
        }
      `}</style>
    </div>
  );
}
