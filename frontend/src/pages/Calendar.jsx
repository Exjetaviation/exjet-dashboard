import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useApi } from '../hooks/useApi';
import { useNavigate } from 'react-router-dom';

const STATUS_COLORS = [
  '#4f8ef7','#22c55e','#a855f7','#f59e0b','#ef4444',
  '#06b6d4','#f97316','#84cc16','#ec4899','#8b5cf6',
  '#14b8a6','#f43f5e','#3b82f6','#10b981','#6366f1',
];
const STATUS = { 0:{label:'Scheduled'},1:{label:'Active'},2:{label:'Booked'},3:{label:'Completed'} };
const VIEWS = {
  day:   { label:'Day',   colMs:3600000,  cols:24,  baseColW:80,  stepMs:86400000    },
  week:  { label:'Week',  colMs:86400000, cols:7,   baseColW:150, stepMs:604800000   },
  month: { label:'Month', colMs:86400000, cols:31,  baseColW:40,  stepMs:2592000000  },
  year:  { label:'Year',  colMs:86400000, cols:365, baseColW:16,  stepMs:31536000000 },
};
const ROW_H=64, HDR_H=48, LABEL_W=120;
const floorDay  = ts=>{const d=new Date(ts);d.setHours(0,0,0,0);return d.getTime();};
const floorHour = ts=>{const d=new Date(ts);d.setMinutes(0,0,0);return d.getTime();};
const fmt = ts=>new Date(ts).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
const fmtTime = ms=>ms?new Date(ms).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';

export default function Calendar() {
  const {data,loading}  = useApi('/api/levelflight/legs');
  const {data:dutyData} = useApi('/api/levelflight/duty');
  const {data:maintData} = useApi('/api/maintenance');
  const navigate = useNavigate();
  const [view,setView]     = useState('week');
  const [offset,setOffset] = useState(0);
  const [zoom,setZoom]     = useState(1);
  const [hovered,setHovered]   = useState(null);
  const [tipPos,setTipPos]     = useState({x:0,y:0});
  const bodyRef = useRef(null);
  const hdrRef  = useRef(null);
  const drag    = useRef({on:false,startX:0,scrollX:0,moved:false});

  const cfg = VIEWS[view];

  const getRangeStart = useCallback(() => {
    const now = new Date();
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

  const effectiveCols = view === 'month'
    ? new Date(new Date(rangeStart).getFullYear(), new Date(rangeStart).getMonth()+1, 0).getDate()
    : cfg.cols;

  const colW    = Math.max(8, Math.round(cfg.baseColW * zoom));
  const totalMs = effectiveCols * cfg.colMs;
  const totalW  = effectiveCols * colW;
  const rangeEnd = rangeStart + totalMs;

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
  useEffect(() => { const t=setTimeout(scrollToCenter,120); return ()=>clearTimeout(t); }, [scrollToCenter,loading,view,zoom]);

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

  const legs = data?.legs||[];
  const dutyTimes = dutyData?.dutyTimes||[];

  const tripColorMap={}; let colorIdx=0;
  legs.forEach(leg => {
    const id=String(leg.dispatch?.tripId||leg._id?.$oid);
    if (!tripColorMap[id]) { tripColorMap[id]=STATUS_COLORS[colorIdx%STATUS_COLORS.length]; colorIdx++; }
  });

  const acMap={};
  legs.forEach(leg => {
    const tail=leg.dispatch?.aircraft?.tailNumber; if(!tail) return;
    if (!acMap[tail]) acMap[tail]={tail,type:leg.dispatch?.aircraft?.type?.name,legs:[]};
    acMap[tail].legs.push(leg);
  });
  const aircraft=Object.values(acMap).sort((a,b)=>a.tail.localeCompare(b.tail));

  const nowPx  = ((Date.now()-rangeStart)/totalMs)*totalW;
  const showNow= nowPx>=0&&nowPx<=totalW;

  const cols = Array.from({length:effectiveCols},(_,i) => {
    const ts=rangeStart+i*cfg.colMs;
    const d=new Date(ts);
    const isToday=floorDay(ts)===floorDay(Date.now());
    const isMonthStart=d.getDate()===1;
    let label='';
    if (view==='day') {
      const h=d.getHours();
      label=h===0?'12am':h===12?'12pm':h<12?`${h}am`:`${h-12}pm`;
    } else if (view==='week') {
      label=`${d.toLocaleDateString('en-US',{weekday:'short'})} ${d.getDate()}`;
    } else if (view==='month') {
      label=String(d.getDate());
    } else {
      label=isMonthStart?d.toLocaleDateString('en-US',{month:'short'}):'';
    }
    return {i,ts,label,isToday,isMonthStart,d};
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
            <button onClick={()=>setZoom((bodyRef.current?.clientWidth||800)/(effectiveCols*cfg.baseColW))} style={{padding:'0 8px',height:'30px',fontSize:'11px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'6px',cursor:'pointer',color:'var(--accent)',fontWeight:'600'}}>Fit</button>
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
                  return (
                    <div key={col.i} style={{width:colW,minWidth:colW,height:HDR_H,display:'flex',alignItems:'center',justifyContent:'center',borderRight:col.isMonthStart?'2px solid rgba(255,255,255,0.16)':'1px solid rgba(255,255,255,0.04)',background:col.isToday?'rgba(79,142,247,0.12)':'transparent',flexShrink:0,overflow:'visible',position:'relative'}}>
                      {view==='year' ? (
                        col.isMonthStart && (
                          <div style={{position:'absolute',left:0,width:daysInThisMonth*colW,height:'100%',display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none',zIndex:2}}>
                            <span style={{fontSize:'12px',fontWeight:'700',color:'#dde',whiteSpace:'nowrap'}}>{col.d.toLocaleDateString('en-US',{month:'long'})}</span>
                          </div>
                        )
                      ) : (
                        col.label && <span style={{fontSize:view==='month'?'11px':'12px',fontWeight:col.isToday||col.isMonthStart?'700':'400',color:col.isToday?'var(--accent)':col.isMonthStart?'#dde':'var(--text-secondary)',whiteSpace:'nowrap'}}>{col.label}</span>
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
            }}
            style={{flex:1,minWidth:0,overflowX:'scroll',overflowY:'auto',cursor:'grab'}}>
            <div style={{width:totalW,position:'relative'}}>
              {loading ? (
                <div style={{padding:'60px',textAlign:'center',color:'var(--text-secondary)'}}>Loading...</div>
              ) : aircraft.map((ac,rowIdx)=>(
                <div key={ac.tail} style={{position:'relative',height:ROW_H,borderBottom:'1px solid var(--border)',background:rowIdx%2===0?'var(--bg-card)':'#111119'}}>

                  {/* Grid lines */}
                  {cols.map(col=>(
                    <div key={col.i} style={{position:'absolute',left:col.i*colW,top:0,bottom:0,width:col.isMonthStart?2:1,background:col.isMonthStart?'rgba(255,255,255,0.13)':'rgba(255,255,255,0.03)',pointerEvents:'none'}}/>
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
                      const gStart=leg.arrival.time, gEnd=next.departure.time;
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
                          style={{position:'absolute',left:blk.left,top:0,width:blk.width,height:ROW_H,background:'repeating-linear-gradient(45deg,rgba(255,255,255,0.025) 0px,rgba(255,255,255,0.025) 4px,transparent 4px,transparent 10px)',borderLeft:'1px solid rgba(255,255,255,0.08)',borderRight:'1px solid rgba(255,255,255,0.08)',zIndex:1,display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden',cursor:'default'}}>
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
                  {/* Maintenance blocks */}
                  {(maintData?.events||[])
                    .filter(ev => ev.aircraft_tail === ac.tail)
                    .map((ev, mi) => {
                      const blk = getBlock(ev.start_time, ev.end_time);
                      if (!blk) return null;
                      const isMx   = ev.type === 'maintenance';
                      const isDown = ev.type === 'aog';
                      const bgColor = isDown ? 'rgba(239,68,68,0.15)' : isMx ? 'rgba(245,158,11,0.15)' : 'rgba(168,85,247,0.15)';
                      const borderColor = isDown ? '#ef4444' : isMx ? '#f59e0b' : '#a855f7';
                      return (
                        <div key={`mx-${mi}`}
                          onMouseEnter={e => { setHovered({ _isMaint: true, title: ev.title, type: ev.type, tail: ev.aircraft_tail, notes: ev.notes, start: ev.start_time, end: ev.end_time }); setTipPos({ x: e.clientX, y: e.clientY }); }}
                          onMouseMove={e => setTipPos({ x: e.clientX, y: e.clientY })}
                          onMouseLeave={() => setHovered(null)}
                          style={{ position: 'absolute', left: blk.left, top: 0, width: blk.width, height: ROW_H, background: bgColor, borderLeft: `3px solid ${borderColor}`, borderRight: `3px solid ${borderColor}`, zIndex: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'default' }}>
                          {blk.width > 40 && (
                            <span style={{ fontSize: '10px', fontWeight: '700', color: borderColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 4px' }}>
                              {isDown ? '⛔' : '🔧'} {blk.width > 80 ? ev.title : ''}
                            </span>
                          )}
                        </div>
                      );
                    })
                  }
                  {/* Duty brackets */}
                  {(()=>{
                    const type11=dutyTimes.filter(d=>{
                      if(!d.out||!d.in) return false;
                      if(d.type!==11) return false;
                      const ds=Math.min(d.out,d.in), de=Math.max(d.out,d.in);
                      return ac.legs.some(leg=>leg.departure?.time&&leg.arrival?.time&&ds<=leg.arrival.time+7200000&&de>=leg.departure.time-7200000);
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
                    const sortedD=[...dutyWithRole].sort((a,b)=>Math.min(a.out,a.in)-Math.min(b.out,b.in));
                    const groups=[];
                    sortedD.forEach(d=>{
                      const ds=Math.min(d.out,d.in);
                      const last=groups[groups.length-1];
                      if(last&&ds-Math.min(last[0].out,last[0].in)<=30*60000){last.push(d);}
                      else{groups.push([d]);}
                    });
                    return groups.map((group,gi)=>{
                      const earliest=Math.min(...group.map(d=>Math.min(d.out,d.in)));
                      const maxDutyEnd=earliest+14*3600000;
                      const startBlk=getBlock(earliest,earliest+1);
                      const endBlk=getBlock(maxDutyEnd,maxDutyEnd+1);
                      const timeRemaining=Math.max(0,Math.round((maxDutyEnd-Date.now())/60000));
                      const onDutyMins=Math.round((Date.now()-earliest)/60000);
                      const durLabel=`${Math.floor(onDutyMins/60)}h ${onDutyMins%60}m on duty`;
                      const limitLabel=timeRemaining>0?`${Math.floor(timeRemaining/60)}h ${timeRemaining%60}m remaining`:'DUTY LIMIT REACHED';
                      const lineColor=timeRemaining<120?'#ef4444':timeRemaining<240?'#f59e0b':'#22c55e';
                      const hasPIC=group.some(d=>d.role==='PIC');
                      return(
                        <React.Fragment key={`dg-${gi}`}>
                          {startBlk&&(
                            <div onMouseEnter={e=>{setHovered({_isDuty:true,label:'Duty IN',time:earliest,duration:durLabel,limit:limitLabel,tail:ac.tail,group:group.map(d=>d.role)});setTipPos({x:e.clientX,y:e.clientY});}} onMouseMove={e=>setTipPos({x:e.clientX,y:e.clientY})} onMouseLeave={()=>setHovered(null)}
                              style={{position:'absolute',left:startBlk.left-1,top:4,width:16,height:ROW_H-8,zIndex:6,cursor:'default',pointerEvents:'auto'}}>
                              <div style={{position:'absolute',left:0,top:0,width:2,height:'100%',background:lineColor,opacity:0.9}}/>
                              {hasPIC&&<div style={{position:'absolute',left:0,top:0,width:10,height:2,background:lineColor,opacity:0.9}}/>}
                              <div style={{position:'absolute',left:0,bottom:0,width:10,height:2,background:lineColor,opacity:0.9}}/>
                              <div style={{position:'absolute',left:3,top:'50%',transform:'translateY(-50%)',fontSize:'10px',color:'#22c55e',fontWeight:'700',lineHeight:1}}>▶</div>
                            </div>
                          )}
                          {endBlk&&(
                            <div onMouseEnter={e=>{setHovered({_isDuty:true,label:'14hr Limit',time:maxDutyEnd,duration:durLabel,limit:limitLabel,tail:ac.tail,isLimit:true,group:group.map(d=>d.role)});setTipPos({x:e.clientX,y:e.clientY});}} onMouseMove={e=>setTipPos({x:e.clientX,y:e.clientY})} onMouseLeave={()=>setHovered(null)}
                              style={{position:'absolute',left:endBlk.left-1,top:4,width:16,height:ROW_H-8,zIndex:6,cursor:'default',pointerEvents:'auto'}}>
                              <div style={{position:'absolute',right:0,top:0,width:2,height:'100%',background:lineColor,opacity:0.9}}/>
                              {hasPIC&&<div style={{position:'absolute',right:0,top:0,width:10,height:2,background:lineColor,opacity:0.9}}/>}
                              <div style={{position:'absolute',right:0,bottom:0,width:10,height:2,background:lineColor,opacity:0.9}}/>
                              <div style={{position:'absolute',right:3,top:'50%',transform:'translateY(-50%)',fontSize:'10px',color:'#ef4444',fontWeight:'700',lineHeight:1}}>◀</div>
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
                    const tripId=String(leg.dispatch?.tripId||leg._id?.$oid);
                    const color=tripColorMap[tripId]||'#4f8ef7';
                    const isHov=hovered?._id?.$oid===leg._id?.$oid;
                    const dest=leg.arrival?.airport||'';
                    const origin=leg.departure?.airport||'';
                    const mins=leg._calc?._minutes||0;
                    return(
                      <div key={leg._id?.$oid||li}
                        onPointerDown={e=>e.stopPropagation()}
                        onClick={e=>{e.stopPropagation();navigate(`/flights/${leg._id?.$oid}`,{state:{leg}});}}
                        onMouseEnter={e=>{setHovered(leg);setTipPos({x:e.clientX,y:e.clientY});}}
                        onMouseMove={e=>setTipPos({x:e.clientX,y:e.clientY})}
                        onMouseLeave={()=>setHovered(null)}
                        style={{position:'absolute',left:blk.left+1,top:8,width:Math.max(blk.width-2,3),height:ROW_H-16,background:color,borderRadius:'5px',cursor:'pointer',opacity:isHov?1:0.85,boxShadow:isHov?`0 2px 12px ${color}99`:'none',border:`1px solid ${color}88`,zIndex:isHov?5:2,display:'flex',alignItems:'center',justifyContent:'space-between',overflow:'hidden',padding:blk.width>20?'0 6px':'0 2px',transition:'opacity .1s'}}>
                        {blk.width>60&&<span style={{fontSize:'10px',color:'rgba(255,255,255,0.8)',fontWeight:'500',whiteSpace:'nowrap',flexShrink:0}}>{origin}</span>}
                        {blk.width>100&&<span style={{fontSize:'10px',color:'rgba(255,255,255,0.6)',whiteSpace:'nowrap',flex:1,textAlign:'center'}}>{Math.floor(mins/60)}h{mins%60>0?`${mins%60}m`:''}</span>}
                        {blk.width>40&&<span style={{fontSize:'10px',color:'#fff',fontWeight:'700',whiteSpace:'nowrap',flexShrink:0,display:'flex',alignItems:'center',gap:'2px'}}>{blk.width>80&&<span style={{color:'rgba(255,255,255,0.6)',fontSize:'9px'}}>→</span>}{dest}</span>}
                      </div>
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
                <p style={{fontSize:'12px',fontWeight:'600',color:hovered.limit?.includes('REACHED')?'var(--danger)':'#f59e0b',margin:0}}>{hovered.limit}</p>
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
                <div style={{width:'10px',height:'10px',borderRadius:'2px',background:tripColorMap[String(hovered.dispatch?.tripId||hovered._id?.$oid)],flexShrink:0}}/>
                <p style={{fontSize:'14px',fontWeight:'700',color:'var(--text-primary)',margin:0}}>{hovered.departure?.airport} → {hovered.arrival?.airport}</p>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:'5px'}}>
                <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>✈ {hovered.dispatch?.aircraft?.tailNumber} · Trip #{hovered.dispatch?.tripId}</p>
                <p style={{fontSize:'12px',color:'var(--text-secondary)',margin:0}}>{fmtTime(hovered.departure?.time)} → {fmtTime(hovered.arrival?.time)}</p>
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
    </div>
  );
}
