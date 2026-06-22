import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import { useAdsb } from '../hooks/useAdsb';
import { useLegActuals } from '../hooks/useLegActuals';
import { useNavigate } from 'react-router-dom';
import { overnightExtraCols, dayOffsetFromNow, monthOffsetFromNow } from '../lib/calendarRange';
const STATUS = { 0:{label:'Scheduled'},1:{label:'Active'},2:{label:'Booked'},3:{label:'Completed'} };
const VIEWS = {
  '12h': { label:'12 hr', colMs:3600000,  cols:12,  baseColW:160, stepMs:43200000    },
  day:   { label:'Day',   colMs:3600000,  cols:24,  baseColW:80,  stepMs:86400000    },
  week:  { label:'Week',  colMs:86400000, cols:7,   baseColW:150, stepMs:604800000   },
  month: { label:'Month', colMs:86400000, cols:31,  baseColW:40,  stepMs:2592000000  },
  year:  { label:'Year',  colMs:86400000, cols:365, baseColW:16,  stepMs:31536000000 },
};

// Block colour by flight STATE (uses actuals when known): completed/landed = blue,
// in-flight = green, future/not-yet-departed = grey.
const STATE_COLORS = { completed:'#4f8ef7', inflight:'#22c55e', future:'#64748b' };
function legStateColor(leg, isAirborne, act, now) {
  const dep = leg?.departure?.time, arr = leg?.arrival?.time;
  const effDep = act?.actualDep ?? dep, effArr = act?.actualArr ?? arr;
  if (isAirborne) return STATE_COLORS.inflight;                                   // ADS-B says airborne
  if (effArr != null && effArr <= now) return STATE_COLORS.completed;            // landed
  if (effDep != null && effDep > now) return STATE_COLORS.future;                // not departed
  if (effDep != null && effArr != null && effDep <= now && now < effArr) return STATE_COLORS.inflight; // mid-flight by clock
  return STATE_COLORS.future;
}
// Row geometry — derived top-down so every row is uniform and nothing floats:
//   ┌───────────────────────────┐  y=0
//   │  flight area (legs/duty)  │
//   ├───────────────────────────┤  y=MX_BASE_TOP
//   │  maintenance strip (16px) │
//   └───────────────────────────┘  y=ROW_H  (bottom-anchored)
const ROW_H=64, HDR_H=48, LABEL_W=120;
const MX_AREA_H=16;                            // maintenance strip height (original compact strip)
const MX_BASE_TOP=ROW_H-MX_AREA_H;             // 48 — strip is the bottom MX_AREA_H of the row
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
const fmtTime = ms=>ms?new Date(ms).toLocaleString('en-US',{timeZone:ET,month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const fmtLocal = (ms,tz)=>{ if(!ms||!tz) return null; try { return new Date(ms).toLocaleString('en-US',{timeZone:tz,month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); } catch { return null; } };

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
  const [selectedWorkOrder, setSelectedWorkOrder] = useState(null);
  const [,forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);
  const bodyRef = useRef(null);
  const hdrRef  = useRef(null);
  const drag    = useRef({on:false,startX:0,scrollX:0,moved:false});

  const cfg = VIEWS[view];

  const getRangeStart = useCallback(() => {
    const now = new Date();
    if (view === '12h') {
      const d = new Date(now); d.setMinutes(0,0,0);
      d.setHours(d.getHours() < 12 ? 0 : 12); // start of the current 12-hour block (00:00 or 12:00)
      return d.getTime() + offset * 43200000;
    }
    if (view === 'day') {
      const d = new Date(now); d.setHours(0,0,0,0);
      return d.getTime() + offset * 86400000;
    }
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

  const rangeStart = getRangeStart();

  const legs = data?.legs || [];

  // Columns that should FILL the viewport (drives autoFit). Day view fits the focused
  // 24h; month fits its day-count; week/year fit cfg.cols.
  const fitCols = view === 'month'
    ? new Date(new Date(rangeStart).getFullYear(), new Date(rangeStart).getMonth()+1, 0).getDate()
    : cfg.cols;
  // Day view only: extra hourly columns past midnight to fully contain overnight
  // flights (0 on a normal day -> identical to before). These render but are NOT
  // counted in the fit, so the focused day stays full-size and the tail scrolls.
  const dayExtraCols = (view === 'day' || view === '12h') ? overnightExtraCols(legs, rangeStart, cfg.colMs) : 0;
  const effectiveCols = fitCols + dayExtraCols;

  const colW    = Math.max(8, Math.round(cfg.baseColW * zoom));
  const totalMs = effectiveCols * cfg.colMs;
  const totalW  = effectiveCols * colW;
  const rangeEnd = rangeStart + totalMs;

  // Persisted actual dep/arr for legs in view (settled delays); live in-progress
  // delays come from the ADS-B feed below.
  const { actuals } = useLegActuals(rangeStart, rangeEnd);

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

  const goToToday = useCallback(() => { setOffset(0); setTimeout(scrollToCenter,80); }, [scrollToCenter]);
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
      if (s !== null && !isNaN(+s)) el.scrollLeft = +s;
      didRestoreScroll.current = true;
    }, 160);
    return () => clearTimeout(t);
  }, [loading]);

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

  // For each tail ADS-B reports airborne, find the leg it's actually flying:
  // the most-recently-departed leg, tolerating schedule slip (up to 6h past the
  // scheduled arrival). We deliberately do NOT require now <= arrival — that's
  // the unreliable schedule estimate, and a real flight running late would
  // otherwise lose its border the moment it passed its scheduled arrival.
  const LATE_GRACE_MS = 6*3600000;
  const airborneLegId = {}; // { tail: leg._id.$oid }
  aircraft.forEach(ac => {
    const la = live[ac.tail];
    if (!la || la.onGround !== false) return; // only when ADS-B says airborne
    let cur = null;
    ac.legs.forEach(l => {
      const dep=l.departure?.time, arr=l.arrival?.time;
      if (!dep || !arr) return;
      if (dep <= nowTs && nowTs <= arr + LATE_GRACE_MS && (!cur || dep > cur.departure.time)) cur = l;
    });
    if (cur) airborneLegId[ac.tail] = cur._id?.$oid;
  });

  const cols = Array.from({length:effectiveCols},(_,i) => {
    const ts=rangeStart+i*cfg.colMs;
    const d=new Date(ts);
    const isToday=floorDay(ts)===floorDay(Date.now());
    const isMonthStart=d.getDate()===1;
    let label='';
    const isDayStart = (view==='day'||view==='12h') && i>0 && d.getHours()===0; // interior midnight
    if (view==='day'||view==='12h') {
      if (isDayStart) {
        label=d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}); // e.g. "Wed, Jun 18"
      } else {
        const h=d.getHours();
        label=h===0?'12am':h===12?'12pm':h<12?`${h}am`:`${h-12}pm`;
      }
    } else if (view==='week') {
      label=`${d.toLocaleDateString('en-US',{weekday:'short'})} ${d.getDate()}`;
    } else if (view==='month') {
      label=String(d.getDate());
    } else {
      label=isMonthStart?d.toLocaleDateString('en-US',{month:'short'}):'';
    }
    return {i,ts,label,isToday,isMonthStart,isDayStart,d};
  });

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
            {loading?'Loading...':`${aircraft.length} aircraft · ${legs.length} legs · same color = same trip`}
          </p>
        </div>
        <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
          <div style={{display:'flex',border:'1px solid var(--border)',borderRadius:'8px',overflow:'hidden'}}>
            {Object.entries(VIEWS).map(([k,{label}])=>(
              <button key={k} onClick={()=>{setView(k);setOffset(0);setZoom(1);}} style={{padding:'7px 14px',fontSize:'13px',border:'none',cursor:'pointer',background:view===k?'var(--accent)':'var(--bg-card)',color:view===k?'#fff':'var(--text-secondary)',fontWeight:view===k?'600':'400'}}>{label}</button>
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
        </div>
      </div>

      {/* NAV ROW */}
      <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
        {navBtn('← Prev',()=>setOffset(o=>o-1))}
        <span style={{fontSize:'13px',color:'var(--text-secondary)',flex:1,textAlign:'center'}}>{`${fmt(rangeStart)} — ${fmt(rangeEnd)}`}</span>
        {navBtn('Next →',()=>setOffset(o=>o+1))}
      </div>

      {/* CALENDAR */}
      <div style={{border:'1px solid var(--border)',borderRadius:'12px',background:'var(--bg-card)',display:'flex',flexDirection:'column',overflow:'hidden',width:'100%',boxSizing:'border-box'}}>

        {/* HEADER */}
        <div style={{display:'flex',borderBottom:'2px solid var(--border)',flexShrink:0}}>
          <div style={{width:LABEL_W,minWidth:LABEL_W,height:HDR_H,background:'var(--bg-secondary)',borderRight:'2px solid var(--border)',display:'flex',alignItems:'center',padding:'0 14px',flexShrink:0}}>
            <span style={{fontSize:'11px',fontWeight:'600',color:'var(--text-secondary)',textTransform:'uppercase',letterSpacing:'0.08em'}}>Aircraft</span>
          </div>
          <div style={{flex:1,overflow:'hidden',minWidth:0}}>
            <div ref={hdrRef} style={{overflowX:'hidden',width:'100%'}}>
              <div style={{display:'flex',width:totalW,height:HDR_H,position:'relative'}}>
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
                      style={{width:colW,minWidth:colW,height:HDR_H,display:'flex',alignItems:'center',justifyContent:'center',borderRight:col.isMonthStart||col.isDayStart?'2px solid rgba(255,255,255,0.16)':'1px solid rgba(255,255,255,0.04)',background:baseBg,flexShrink:0,overflow:'visible',position:'relative',cursor:drillTarget?'pointer':'default'}}>
                      {view==='year' ? (
                        col.isMonthStart && (
                          <div style={{position:'absolute',left:0,width:daysInThisMonth*colW,height:'100%',display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none',zIndex:2}}>
                            <span style={{fontSize:'12px',fontWeight:'700',color:'#dde',whiteSpace:'nowrap'}}>{col.d.toLocaleDateString('en-US',{month:'long'})}</span>
                          </div>
                        )
                      ) : (
                        col.label && <span style={{fontSize:view==='month'?'11px':'12px',fontWeight:col.isToday||col.isMonthStart||col.isDayStart?'700':'400',color:col.isToday?'var(--accent)':col.isMonthStart||col.isDayStart?'#dde':'var(--text-secondary)',whiteSpace:'nowrap'}}>{col.label}</span>
                      )}
                    </div>
                  );
                })}
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
              const lbl=document.getElementById('lbl-col');
              if(lbl)lbl.scrollTop=e.target.scrollTop;
              if(didRestoreScroll.current) localStorage.setItem('exjet.calendar.scroll', String(e.target.scrollLeft));
            }}
            style={{flex:1,minWidth:0,overflowX:'scroll',overflowY:'auto',cursor:'grab'}}>
            <div style={{width:totalW,position:'relative'}}>
              {loading ? (
                <div style={{padding:'60px',textAlign:'center',color:'var(--text-secondary)'}}>Loading...</div>
              ) : aircraft.map((ac,rowIdx)=>(
                <div key={ac.tail} style={{position:'relative',height:ROW_H,borderBottom:'1px solid var(--border)',background:rowIdx%2===0?'var(--bg-card)':'#111119'}}>

                  {/* Grid lines */}
                  {cols.map(col=>(
                    <div key={col.i} style={{position:'absolute',left:col.i*colW,top:0,bottom:0,width:col.isMonthStart||col.isDayStart?2:1,background:col.isMonthStart||col.isDayStart?'rgba(255,255,255,0.13)':'rgba(255,255,255,0.03)',pointerEvents:'none'}}/>
                  ))}

                  {/* Today highlight */}
                  {cols.filter(c=>c.isToday).map(col=>(
                    <div key={col.i} style={{position:'absolute',left:col.i*colW,top:0,bottom:0,width:colW,background:'rgba(79,142,247,0.05)',pointerEvents:'none'}}/>
                  ))}

                  {/* Now line */}
                  {showNow&&(
                    <div style={{position:'absolute',left:nowPx,top:0,bottom:0,width:2,background:'var(--danger)',boxShadow:'0 0 6px rgba(239,68,68,0.5)',zIndex:4,pointerEvents:'none'}}>
                      {rowIdx===0&&<div style={{position:'absolute',top:4,left:4,background:'var(--danger)',borderRadius:'3px',padding:'2px 5px',fontSize:'9px',color:'#fff',fontWeight:'700',whiteSpace:'nowrap'}}>NOW</div>}
                    </div>
                  )}

                  {/* Ground time blocks */}
                  {(()=>{
                    const sorted=[...ac.legs].filter(l=>l.departure?.time&&l.arrival?.time).sort((a,b)=>a.departure.time-b.departure.time);
                    return sorted.slice(0,-1).map((leg,i)=>{
                      const next=sorted[i+1];
                      // Ground time reflects ACTUAL arrival/departure when known (a late
                      // arrival or late next-departure shifts/shrinks the time on the ground).
                      const aPrev=actuals[leg._id?.$oid]||{}, aNext=actuals[next._id?.$oid]||{};
                      const gStart=aPrev.actualArr??leg.arrival.time, gEnd=aNext.actualDep??next.departure.time;
                      if(gEnd-gStart<600000) return null;
                      const blk=getBlock(gStart,gEnd); if(!blk) return null;
                      const airport=leg.arrival?.airport||'?';
                      const gMins=Math.round((gEnd-gStart)/60000);
                      const durLabel=gMins>=60?`${Math.floor(gMins/60)}h ${gMins%60}m`:`${gMins}m`;
                      return(
                        <div key={`g-${i}`}
                          onMouseEnter={e=>{setHovered({_isGround:true,airport,duration:durLabel,start:gStart,end:gEnd});setTipPos({x:e.clientX,y:e.clientY});}}
                          onMouseMove={e=>setTipPos({x:e.clientX,y:e.clientY})}
                          onMouseLeave={()=>setHovered(null)}
                          style={{position:'absolute',left:blk.left,top:0,width:blk.width,height:GROUND_H,background:'repeating-linear-gradient(45deg,rgba(255,255,255,0.025) 0px,rgba(255,255,255,0.025) 4px,transparent 4px,transparent 10px)',borderLeft:'1px solid rgba(255,255,255,0.08)',borderRight:'1px solid rgba(255,255,255,0.08)',zIndex:1,display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden',cursor:'default'}}>
                          {blk.width>50&&(
                            <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'1px'}}>
                              <span style={{fontSize:'10px',fontWeight:'700',color:'rgba(255,255,255,0.4)'}}>{airport}</span>
                              {blk.width>90&&<span style={{fontSize:'9px',color:'rgba(255,255,255,0.25)'}}>{durLabel}</span>}
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
                    // Every case divides the full strip evenly. 1 lane = full 32px block,
                    // anchored to the row's bottom edge via MX_BASE_TOP = ROW_H - MX_AREA_H.
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
                          style={{ position: 'absolute', left: blk.left, top, width: blk.width, height: laneH, background: bgColor, borderLeft: `2px solid ${borderColor}`, borderRight: `2px solid ${borderColor}`, zIndex: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'pointer', lineHeight: 1 }}>
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
                      const matches=ac.legs.some(leg=>leg.departure?.time&&leg.arrival?.time&&inf.start<=leg.arrival.time+7200000&&inf.end>=leg.departure.time-7200000);
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
                    const sortedD=[...dutyWithRole].sort((a,b)=>a._start-b._start);
                    const groups=[];
                    sortedD.forEach(d=>{
                      const last=groups[groups.length-1];
                      if(last&&d._start-last[0]._start<=30*60000){last.push(d);}
                      else{groups.push([d]);}
                    });
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
                      const startDuration=groupOpen?onDutyLabel:totalLabel;
                      const startLimit=groupOpen?remainingLabel:'';
                      const endLabel=groupOpen?'14hr Limit':`Flight Duty OFF · ${totalLabel}`;
                      const endLimit=groupOpen?remainingLabel:'';
                      const endTriangleColor=groupOpen?'#ef4444':lineColor;
                      return(
                        <React.Fragment key={`dg-${gi}`}>
                          {startBlk&&(
                            <div onMouseEnter={e=>{setHovered({_isDuty:true,label:'Flight Duty START',time:earliest,duration:startDuration,limit:startLimit,tail:ac.tail,group:group.map(d=>d.role)});setTipPos({x:e.clientX,y:e.clientY});}} onMouseMove={e=>setTipPos({x:e.clientX,y:e.clientY})} onMouseLeave={()=>setHovered(null)}
                              style={{position:'absolute',left:startBlk.left-1,top:DUTY_TOP,width:16,height:DUTY_H,zIndex:6,cursor:'default',pointerEvents:'auto'}}>
                              <div style={{position:'absolute',left:0,top:0,width:2,height:'100%',background:lineColor,opacity:0.9}}/>
                              {hasPIC&&<div style={{position:'absolute',left:0,top:0,width:10,height:2,background:lineColor,opacity:0.9}}/>}
                              <div style={{position:'absolute',left:0,bottom:0,width:10,height:2,background:lineColor,opacity:0.9}}/>
                              <div style={{position:'absolute',left:3,top:'50%',transform:'translateY(-50%)',fontSize:'10px',color:'#22c55e',fontWeight:'700',lineHeight:1}}>▶</div>
                            </div>
                          )}
                          {endBlk&&(
                            <div onMouseEnter={e=>{setHovered({_isDuty:true,label:endLabel,time:groupEnd,duration:startDuration,limit:endLimit,tail:ac.tail,isLimit:groupOpen,group:group.map(d=>d.role)});setTipPos({x:e.clientX,y:e.clientY});}} onMouseMove={e=>setTipPos({x:e.clientX,y:e.clientY})} onMouseLeave={()=>setHovered(null)}
                              style={{position:'absolute',left:endBlk.left-1,top:DUTY_TOP,width:16,height:DUTY_H,zIndex:6,cursor:'default',pointerEvents:'auto'}}>
                              <div style={{position:'absolute',right:0,top:0,width:2,height:'100%',background:lineColor,opacity:0.9}}/>
                              {hasPIC&&<div style={{position:'absolute',right:0,top:0,width:10,height:2,background:lineColor,opacity:0.9}}/>}
                              <div style={{position:'absolute',right:0,bottom:0,width:10,height:2,background:lineColor,opacity:0.9}}/>
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
                    const aStart=act.actualDep??(isAirborne?(la?.airborneSinceMs??null):null);
                    const aEnd=act.actualArr??(isAirborne?nowTs:null);
                    const actBlk=(aStart!=null&&aEnd!=null&&aEnd>aStart)?getBlock(aStart,aEnd):null;
                    const open=e=>{e.stopPropagation();tripBasePath?navigate(`${tripBasePath}/${leg.dispatch?._id?.$oid}`):navigate(`/flights/${leg._id?.$oid}`,{state:{leg}});};
                    const hov=e=>{setHovered(leg);setHoverMode('sched');setTipPos({x:e.clientX,y:e.clientY});};
                    const hovA=e=>{setHovered(leg);setHoverMode('actual');setTipPos({x:e.clientX,y:e.clientY});};
                    const moveTip=e=>setTipPos({x:e.clientX,y:e.clientY});
                    return(
                      <React.Fragment key={legId||li}>
                        {/* Scheduled flight — transparent, covers the whole planned span */}
                        <div onPointerDown={e=>e.stopPropagation()} onClick={open} onMouseEnter={hov} onMouseMove={moveTip} onMouseLeave={()=>setHovered(null)}
                          style={{position:'absolute',left:blk.left+1,top:FLIGHT_TOP,width:Math.max(blk.width-2,3),height:FLIGHT_H,background:`${color}33`,border:`1px solid ${color}99`,borderRadius:'5px',cursor:'pointer',boxShadow:isHov?`0 2px 12px ${color}66`:'none',zIndex:isHov?5:2,boxSizing:'border-box'}}/>
                        {/* Actual flight — solid bar at 60% height, vertically centred */}
                        {actBlk&&<div onPointerDown={e=>e.stopPropagation()} onClick={open} onMouseEnter={hovA} onMouseMove={moveTip} onMouseLeave={()=>setHovered(null)}
                          style={{position:'absolute',left:actBlk.left+1,top:FLIGHT_TOP+Math.round(FLIGHT_H*0.2),width:Math.max(actBlk.width-2,3),height:Math.round(FLIGHT_H*0.6),background:color,borderRadius:'4px',cursor:'pointer',border:isAirborne?`2px solid ${darker}`:'none',...(isAirborne?{'--ab':darker,animation:'exjetAirbornePulse 1.6s ease-in-out infinite'}:null),zIndex:isAirborne?7:4,boxSizing:'border-box'}}/>}
                        {/* Route, centred in the solid actual bar (or the scheduled block if not yet flown) */}
                        {(()=>{
                          const lb=actBlk||blk; if(lb.width<40) return null;
                          const onBar=!!actBlk;
                          return <div style={{position:'absolute',left:lb.left+1,top:onBar?FLIGHT_TOP+Math.round(FLIGHT_H*0.2):FLIGHT_TOP,width:Math.max(lb.width-2,3),height:onBar?Math.round(FLIGHT_H*0.6):FLIGHT_H,zIndex:9,pointerEvents:'none',display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden',padding:'0 4px'}}>
                            <span style={{fontSize:'10px',fontWeight:'600',color:'#fff',whiteSpace:'nowrap',textShadow:'0 1px 1px rgba(0,0,0,0.35)'}}>{origin}→{dest}</span>
                          </div>;
                        })()}
                        {/* Live in-flight: plane at the growing leading edge of the actual bar (grows with the now-bar) */}
                        {actBlk&&isAirborne&&act.actualArr==null&&<div style={{position:'absolute',left:actBlk.left+actBlk.width-8,top:FLIGHT_TOP+Math.round(FLIGHT_H*0.5)-8,zIndex:10,pointerEvents:'none',fontSize:'14px',lineHeight:1,color:'#fff',transform:'rotate(45deg)',textShadow:'0 0 5px rgba(0,0,0,0.85)'}}>✈</div>}
                      </React.Fragment>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
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
                <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>Time: {fmtTime(hovered.time)}</p>
                {hovered.group&&<p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>Crew: {hovered.group.join(' + ')}</p>}
                <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>{hovered.duration}</p>
                {hovered.limit && <p style={{fontSize:'12px',fontWeight:'600',color:hovered.limit?.includes('REACHED')?'var(--danger)':'#f59e0b',margin:0}}>{hovered.limit}</p>}
              </div>
            </>
          ):hovered._isGround?(
            <>
              <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'10px'}}>
                <div style={{width:'10px',height:'10px',borderRadius:'2px',background:'rgba(255,255,255,0.2)',border:'1px solid rgba(255,255,255,0.3)'}}/>
                <p style={{fontSize:'14px',fontWeight:'700',color:'var(--text-primary)',margin:0}}>On Ground · {hovered.airport}</p>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
                <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>Duration: {hovered.duration}</p>
                <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>From: {fmtTime(hovered.start)}</p>
                <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>Until: {fmtTime(hovered.end)}</p>
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
      <style>{`
        @keyframes exjetAirbornePulse {
          0%, 100% { box-shadow: 0 0 2px 0 var(--ab); }
          50%      { box-shadow: 0 0 8px 2px var(--ab); }
        }
      `}</style>
    </div>
  );
}
