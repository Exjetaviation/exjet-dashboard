// backend/src/services/tripSheetHtml.js
// Renders the crew Trip Sheet (Flight Release) view-model to a self-contained
// "Midnight" HTML document — same design family as the quote/itinerary, with the
// operational content crews need (call signs, comms, METARs, FBOs, crew, passenger
// manifest, aircraft maintenance/currency). Used for the dashboard modal AND the PDF.
import { LOGO_DATA_URI } from '../assets/quote/assets.js';
import { mapScript } from './docMap.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtLocal = (ms, tz) => {
  if (ms == null) return '';
  try { return new Date(ms).toLocaleString('en-US', { timeZone: tz || undefined, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }); }
  catch { return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
};
const fmtZ = (ms) => (ms == null ? '' : new Date(ms).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour12: false, hour: '2-digit', minute: '2-digit' }) + ' Z');
const fmtDate = (ms) => (ms == null ? '' : new Date(ms).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }));
const fmtMin = (m) => (m == null ? '' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`);
const commsLine = (c) => (c ? Object.entries(c).map(([k, v]) => `${k} ${esc(v)}`).join(' · ') : '');

function crewCell(label, m) {
  if (!m || !m.name) return '';
  const extra = [m.dob ? 'DOB ' + fmtDate(m.dob) : '', m.phone ? esc(m.phone) : ''].filter(Boolean).join(' · ');
  return `<div class="cr"><span class="crl">${label}</span> <span class="crn">${esc(m.name)}</span>${extra ? `<div class="crx">${extra}</div>` : ''}</div>`;
}

function fboCell(label, fbo) {
  if (!fbo || !(fbo.name || fbo.address)) return '';
  const arinc = [fbo.arinc ? 'ARINC ' + esc(fbo.arinc) : '', fbo.atg ? 'ATG ' + esc(fbo.atg) : ''].filter(Boolean).join(' · ');
  return `<div class="fbo"><div class="fbol">${label}</div>
    <div class="fbon">${esc(fbo.name || '')}</div>
    ${fbo.address ? `<div class="fboa">${esc(fbo.address)}</div>` : ''}
    ${(fbo.phones || []).map((p) => `<div class="fboa">P: ${esc(p)}</div>`).join('')}
    ${arinc ? `<div class="fboa">${arinc}</div>` : ''}
    ${fbo.crewNote ? `<div class="fbonote">${esc(fbo.crewNote)}</div>` : ''}</div>`;
}

const WINGS = '<svg class="wings" width="132" height="16" viewBox="0 0 132 16" fill="none" stroke="#aab4c2" stroke-width="1" stroke-linecap="round"><circle cx="66" cy="8" r="2.6" fill="#c4ced9" stroke="none"/><path d="M61 8 L46 5 M61 8 L42 7 M61 9 L44 9.5 M61 9 L48 11.5 M61 10 L53 13"/><path d="M71 8 L86 5 M71 8 L90 7 M71 9 L88 9.5 M71 9 L84 11.5 M71 10 L79 13"/></svg>';

function legBlock(leg, i, n) {
  const c = leg.crew || {};
  const crew = [crewCell('PIC', c.pic), crewCell('SIC', c.sic), ...(c.ca || []).map((m) => crewCell('CA', m))].filter(Boolean).join('');
  const meta = [leg.eft ? 'EFT ' + esc(leg.eft) : '', leg.distance != null ? esc(leg.distance) + ' nm' : '', leg.fuelBurn != null ? 'Burn ' + esc(leg.fuelBurn) + ' lbs' : '', leg.pax != null ? esc(leg.pax) + ' PAX' : ''].filter(Boolean).join(' · ');
  const ft = leg.flightType || {};
  return `<div class="leg">
    <div class="legsep">
      ${WINGS}
      <div class="legtitle">LEG ${i + 1} OF ${n}</div>
      <div class="legtype ${ft.part === 135 ? 'is135' : 'is91'}">${esc(ft.label || '')}</div>
      <div class="legsub">${leg.callSign ? '<span class="csign">' + esc(leg.callSign) + '</span>' : ''}${meta ? `<span class="legmeta">${meta}</span>` : ''}</div>
    </div>
    <div class="legroute">
      <div><div class="apt">${esc(leg.from || '')}</div><div class="aptn">${esc(leg.fromName || '')}${leg.fromElev != null ? ` · elev ${esc(leg.fromElev)}'` : ''}</div><div class="aptt">${esc(fmtLocal(leg.depTime, leg.depTz))}</div><div class="aptz">${esc(fmtZ(leg.depTime))}</div></div>
      <div class="line"><span class="plane">&#9992;</span></div>
      <div style="text-align:right"><div class="apt">${esc(leg.to || '')}</div><div class="aptn">${esc(leg.toName || '')}${leg.toElev != null ? ` · elev ${esc(leg.toElev)}'` : ''}</div><div class="aptt">${esc(fmtLocal(leg.arrTime, leg.arrTz))}</div><div class="aptz">${esc(fmtZ(leg.arrTime))}</div></div>
    </div>
    ${(leg.depComms || leg.arrComms) ? `<div class="comms"><div><span class="cl">DEP COMMS</span> ${commsLine(leg.depComms)}</div><div><span class="cl">ARR COMMS</span> ${commsLine(leg.arrComms)}</div></div>` : ''}
    ${(leg.depMetar || leg.arrMetar) ? `<div class="metar">${leg.depMetar ? `<div>${esc(leg.depMetar)}</div>` : ''}${leg.arrMetar ? `<div>${esc(leg.arrMetar)}</div>` : ''}</div>` : ''}
    ${crew ? `<div class="crew">${crew}</div>` : ''}
    <div class="fbos">${fboCell('DEPARTURE FBO', leg.depFbo)}${fboCell('ARRIVAL FBO', leg.arrFbo)}</div>
    ${(leg.crewNote || leg.releasedBy) ? `<div class="relnote">${leg.crewNote ? `<span class="cl">CREW NOTE</span> ${esc(leg.crewNote)} ` : ''}${leg.releasedBy ? `<span class="cl">RELEASED BY</span> ${esc(leg.releasedBy)}${leg.releasedAt ? ' · ' + esc(fmtZ(leg.releasedAt)) : ''}` : ''}</div>` : ''}
  </div>`;
}

function manifestBlock(manifest) {
  if (!manifest || !manifest.length) return '';
  const rows = manifest.map((p) => `<tr><td>${esc(p.name || '')}</td><td>${esc(p.gender || '')}</td><td>${p.weight != null ? esc(p.weight) + ' lbs' : ''}</td><td>${esc(fmtDate(p.dob))}</td><td>${esc(p.citizenship || '')}</td><td>${esc(p.passport || '')}</td></tr>`).join('');
  return `<div class="sec">PASSENGER MANIFEST (${manifest.length})</div>
    <table class="tbl"><thead><tr><th>Name</th><th>Gender</th><th>Weight</th><th>DOB</th><th>Citizenship</th><th>Passport</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function maintenanceBlock(m) {
  if (!m) return '';
  const af = m.airframe || {};
  const eng = (m.engines || []).map((e) => `<div class="mxline"><span class="cl">ENG ${esc(e.pos)}</span> ${esc(e.model || '')}${e.serial ? ' · S/N ' + esc(e.serial) : ''}</div>`).join('');
  const apu = m.apu ? `<div class="mxline"><span class="cl">APU</span> ${esc(m.apu.model || '')}${m.apu.serial ? ' · S/N ' + esc(m.apu.serial) : ''}</div>` : '';
  const up = (m.upcoming || []).length
    ? `<table class="tbl"><thead><tr><th>Upcoming maintenance</th><th>Due (hrs)</th><th>Remaining</th></tr></thead><tbody>${m.upcoming.map((x) => `<tr><td>${esc(x.name || '')}</td><td>${x.due != null ? esc(x.due) : ''}</td><td>${x.remaining != null ? esc(x.remaining) + ' hrs' : ''}</td></tr>`).join('')}</tbody></table>` : '';
  const closed = (m.closed || []).length
    ? `<div class="mxsub">Recently closed</div>${m.closed.map((x) => `<div class="mxline">${esc(x.title || '')}${x.date ? ' · ' + esc(fmtDate(x.date)) : ''}</div>`).join('')}` : '';
  return `<div class="sec">AIRCRAFT STATUS &amp; CURRENCY</div>
    <div class="mxbox">
      <div class="mxline"><span class="cl">AIRFRAME</span> ${esc(af.type || '')}${af.serial ? ' · S/N ' + esc(af.serial) : ''}${af.hours != null ? ' · ' + esc(af.hours) + ' hrs' : ''}${af.landings != null ? ' · ' + esc(af.landings) + ' ldg' : ''}${af.reported ? ' · as of ' + esc(fmtDate(af.reported)) : ''}</div>
      ${eng}${apu}
      ${up}${closed}
    </div>`;
}

export function renderTripSheetHtml(vm, { print = false } = {}) {
  const cl = vm.client || {};
  const op = vm.operator || {};
  const ac = vm.aircraft || {};
  const t = vm.totals || {};
  return `<!doctype html><html><head><meta charset="utf-8">
<title>Exjet Trip Sheet${vm.tripNumber ? ' #' + esc(vm.tripNumber) : ''}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,Segoe UI,Roboto,sans-serif; color:#e8edf4; background:#0b1018; }
  .page { max-width:820px; margin:0 auto; }
  .hdr { display:flex; justify-content:space-between; align-items:flex-start; padding:24px 30px 16px; }
  .logo { height:58px; }
  .addr { font-size:10px; color:#6b7890; margin-top:10px; line-height:1.6; }
  .qmeta { text-align:right; font-size:11px; color:#8a98ad; line-height:1.7; }
  .qlabel { font-size:13px; letter-spacing:4px; color:#c4ced9; }
  .rule { height:1px; background:linear-gradient(90deg,transparent,#aab4c2,transparent); }
  .prep { padding:12px 30px 4px; font-size:11px; color:#8a98ad; } .prep .nm { color:#fff; font-weight:600; font-size:14px; }
  .summary { padding:6px 30px; font-size:12px; color:#cfe0f5; letter-spacing:1px; }
  .hero { display:flex; gap:24px; padding:12px 30px; align-items:baseline; }
  .tail { font-size:28px; font-weight:700; color:#fff; } .type { font-size:12px; color:#c4ced9; }
  .totals { display:flex; gap:18px; margin-left:auto; font-size:11px; color:#8a98ad; }
  .totals b { color:#fff; font-size:15px; display:block; }
  .sec { font-size:10px; letter-spacing:3px; color:#6b7890; margin:16px 30px 6px; }
  .leg { padding:4px 30px 20px; }
  .legsep { text-align:center; padding:18px 0 12px; margin-top:8px; border-top:1px solid #233247; }
  .wings { display:block; margin:0 auto 7px; opacity:.92; }
  .legtitle { font-size:13px; letter-spacing:5px; color:#fff; font-weight:700; }
  .legtype { display:inline-block; margin-top:6px; font-size:10px; letter-spacing:2px; padding:2px 11px; border-radius:20px; }
  .legtype.is135 { color:#0b1018; background:linear-gradient(90deg,#cfd6e0,#aab4c2); font-weight:700; }
  .legtype.is91 { color:#cfe0f5; border:1px solid #2a3852; }
  .legsub { margin-top:8px; display:flex; gap:12px; justify-content:center; align-items:center; flex-wrap:wrap; }
  .csign { font-size:10px; letter-spacing:1px; color:#8a98ad; border:1px solid #233247; border-radius:5px; padding:1px 7px; }
  .legmeta { font-size:10px; color:#8a98ad; }
  .legroute { display:flex; align-items:center; gap:10px; margin:8px 0; }
  .apt { font-size:18px; font-weight:600; color:#fff; }
  .aptn { font-size:10px; color:#8a98ad; } .aptt { font-size:11px; color:#cfe0f5; margin-top:2px; } .aptz { font-size:10px; color:#6b7890; }
  .line { flex:1; height:1px; background:linear-gradient(90deg,#38bdf8,#2a3852); position:relative; }
  .plane { position:absolute; right:0; top:-8px; color:#38bdf8; }
  .comms { display:flex; gap:24px; font-size:10px; color:#aeb9c9; margin:4px 0; flex-wrap:wrap; }
  .cl { font-size:9px; letter-spacing:1px; color:#6b7890; }
  .metar { font-family:ui-monospace,Menlo,monospace; font-size:10px; color:#9fb3c8; background:#0e1622; border:1px solid #1a2638; border-radius:6px; padding:6px 8px; margin:6px 0; line-height:1.5; }
  .crew { display:flex; flex-wrap:wrap; gap:8px 20px; margin:6px 0; }
  .crl { font-size:9px; letter-spacing:1px; color:#6b7890; } .crn { font-size:12px; color:#e8edf4; } .crx { font-size:9px; color:#8a98ad; }
  .fbos { display:flex; gap:14px; margin-top:6px; }
  .fbo { flex:1; background:#0e1622; border:1px solid #1a2638; border-radius:7px; padding:8px 10px; }
  .fbol { font-size:9px; letter-spacing:1px; color:#6b7890; } .fbon { font-size:12px; color:#fff; font-weight:600; margin-top:2px; } .fboa { font-size:10px; color:#8a98ad; } .fbonote { font-size:9px; color:#8a98ad; margin-top:4px; font-style:italic; }
  .relnote { font-size:10px; color:#8a98ad; margin-top:6px; }
  #map { margin:14px 30px; height:220px; border-radius:9px; border:1px solid #233247; background:#0a0f18; }
  .nomap { display:flex; height:100%; align-items:center; justify-content:center; color:#5b6b82; font-size:12px; }
  .tbl { width:calc(100% - 60px); margin:0 30px; border-collapse:collapse; font-size:10px; }
  .tbl th { text-align:left; color:#6b7890; font-weight:600; border-bottom:1px solid #233247; padding:5px 8px; font-size:9px; letter-spacing:1px; }
  .tbl td { color:#cfd6e0; border-bottom:1px solid #141e2e; padding:5px 8px; }
  .mxbox { margin:0 30px; background:#0e1622; border:1px solid #1a2638; border-radius:8px; padding:10px 12px; }
  .mxline { font-size:11px; color:#cfd6e0; padding:2px 0; } .mxsub { font-size:9px; letter-spacing:1px; color:#6b7890; margin:8px 0 2px; }
  .mxbox .tbl { width:100%; margin:8px 0 0; }
  .foot { padding:18px 30px 30px; font-size:9px; color:#5b6b82; }
  ${print ? '.leg{break-inside:avoid;} .mxbox{break-inside:avoid;}' : ''}
</style></head>
<body><div class="page">
  <div class="hdr">
    <div>${LOGO_DATA_URI ? `<img class="logo" src="${LOGO_DATA_URI}" alt="Exjet">` : '<div class="tail">EXJET</div>'}
      <div class="addr">${esc(op.name || 'EXJET AVIATION')}${op.address ? '<br>' + esc(op.address) : ''}${op.cert ? '<br>Cert ' + esc(op.cert) : ''}</div></div>
    <div class="qmeta"><div class="qlabel">TRIP SHEET</div>
      <div style="margin-top:10px">Trip <span style="color:#fff;font-weight:600">${esc(vm.tripNumber || '—')}</span><br>Quote ${esc(vm.quoteNumber || '—')}<br>Prepared ${esc(vm.preparedOn || '')}${vm.tsa != null ? `<br>TSA: ${esc(vm.tsa)}` : ''}</div></div>
  </div>
  <div class="rule"></div>
  ${(cl.name || cl.company) ? `<div class="prep">PREPARED FOR<br><span class="nm">${esc(cl.name || cl.company)}</span>${cl.company && cl.name ? ` · ${esc(cl.company)}` : ''}${cl.address ? `<br>${esc(cl.address)}` : ''}</div>` : ''}
  ${vm.routeSummary ? `<div class="summary">${esc(vm.routeSummary)}</div>` : ''}
  <div class="hero">
    <div><div class="tail">${esc(ac.tail || '')}</div><div class="type">${esc(ac.type || '')}${ac.serial ? ' · S/N ' + esc(ac.serial) : ''}${ac.maxPax ? ' · ' + esc(ac.maxPax) + ' seats' : ''}</div></div>
    <div class="totals"><div>LEGS<b>${esc(t.legs ?? '')}</b></div><div>DISTANCE<b>${t.distance != null ? esc(t.distance) + ' nm' : '—'}</b></div><div>TIME<b>${t.minutes != null ? esc(fmtMin(t.minutes)) : '—'}</b></div></div>
  </div>
  <div class="sec">ITINERARY · CREW · COMMS · WEATHER</div>
  ${vm.legs.map((leg, i) => legBlock(leg, i, vm.legs.length)).join('')}
  <div id="map"></div>
  ${manifestBlock(vm.manifest)}
  ${maintenanceBlock(vm.maintenance)}
  <div class="foot">Generated ${esc(vm.preparedOn || '')} · ${esc(op.name || 'Exjet Aviation')} · Operational flight release — crew use only.</div>
</div>
<script>${mapScript(vm)}</script>
</body></html>`;
}
