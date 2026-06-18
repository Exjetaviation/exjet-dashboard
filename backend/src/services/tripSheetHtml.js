// backend/src/services/tripSheetHtml.js
// Renders a trip-sheet view-model to a self-contained "Midnight" HTML document used
// for the public web page AND the Puppeteer PDF (single source of truth). Mirrors the
// quote document's styling and reuses the shared map+plane script.
import { LOGO_DATA_URI, aircraftPhotos } from '../assets/quote/assets.js';
import { mapScript } from './docMap.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDT = (ms) => (ms == null ? '' : new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
const fmtDay = (iso) => { const d = new Date(iso + 'T12:00:00'); return Number.isNaN(d.getTime()) ? esc(iso) : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };

function crewCell(label, name) {
  return name ? `<div class="cr"><span class="crl">${label}</span> <span class="crn">${esc(name)}</span></div>` : '';
}

function fboCell(label, fbo) {
  if (!fbo || !(fbo.name || fbo.address)) return '';
  return `<div class="fbo"><div class="fbol">${label}</div>
    <div class="fbon">${esc(fbo.name || '')}</div>
    ${fbo.address ? `<div class="fboa">${esc(fbo.address)}</div>` : ''}
    ${fbo.phone ? `<div class="fboa">${esc(fbo.phone)}</div>` : ''}</div>`;
}

function legBlock(leg, i) {
  const c = leg.crew || {};
  const crew = [crewCell('PIC', c.pic), crewCell('SIC', c.sic), ...(c.ca || []).map((n) => crewCell('CA', n))].filter(Boolean).join('');
  const meta = [leg.eft ? esc(leg.eft) : '', leg.distance != null ? esc(leg.distance) + ' nm' : '', leg.pax != null ? esc(leg.pax) + ' PAX' : ''].filter(Boolean).join(' · ');
  return `<div class="leg">
    <div class="leghd"><span class="legno">LEG ${i + 1}</span><span class="legmeta">${meta}</span></div>
    <div class="legroute">
      <div><div class="apt">${esc(leg.from || '')}</div><div class="aptn">${esc(leg.fromName || '')}</div><div class="aptt">${esc(fmtDT(leg.depTime))}</div></div>
      <div class="line"><span class="plane">&#9992;</span></div>
      <div style="text-align:right"><div class="apt">${esc(leg.to || '')}</div><div class="aptn">${esc(leg.toName || '')}</div><div class="aptt">${esc(fmtDT(leg.arrTime))}</div></div>
    </div>
    ${crew ? `<div class="crew">${crew}</div>` : ''}
    <div class="fbos">${fboCell('DEPARTURE FBO', leg.depFbo)}${fboCell('ARRIVAL FBO', leg.arrFbo)}</div>
  </div>`;
}

function weatherBlock(weather) {
  if (!weather || !weather.length) return '';
  const cards = weather.map((w) => `<div class="wx">
    <div class="wxa">${esc(w.code)}${w.name ? ` · ${esc(w.name)}` : ''}</div>
    <div class="wxd">${(w.forecast || []).map((f) => `<div class="wxday"><div class="wxdt">${fmtDay(f.date)}</div><div class="wxc">${esc(f.condition)}</div><div class="wxt">${esc(f.highF)}&deg; / ${esc(f.lowF)}&deg;</div></div>`).join('')}</div>
  </div>`).join('');
  return `<div class="sec">WEATHER</div><div class="wxwrap">${cards}</div>`;
}

export function renderTripSheetHtml(vm, { print = false, web = false } = {}) {
  const photos = aircraftPhotos(vm.tail);
  const photoImg = (src, alt) => (src ? `<img src="${src}" alt="${alt}" class="acimg">` : '');
  const cl = vm.client || {};
  return `<!doctype html><html><head><meta charset="utf-8">
<title>Exjet Trip Sheet${vm.tripNumber ? ' #' + esc(vm.tripNumber) : ''}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,Segoe UI,Roboto,sans-serif; color:#e8edf4; background:#0b1018; }
  .page { max-width:760px; margin:0 auto; }
  .hdr { display:flex; justify-content:space-between; align-items:flex-start; padding:26px 30px 18px; }
  .logo { height:62px; }
  .addr { font-size:10px; color:#6b7890; margin-top:12px; line-height:1.6; }
  .qmeta { text-align:right; font-size:11px; color:#8a98ad; line-height:1.7; }
  .qlabel { font-size:13px; letter-spacing:4px; color:#c4ced9; }
  .rule { height:1px; background:linear-gradient(90deg,transparent,#aab4c2,transparent); }
  .prep { padding:14px 30px 4px; font-size:11px; color:#8a98ad; }
  .prep .nm { color:#fff; font-weight:600; font-size:14px; }
  .hero { display:flex; gap:18px; padding:18px 30px; align-items:center; }
  .tail { font-size:30px; font-weight:700; color:#fff; }
  .type { font-size:12px; color:#c4ced9; letter-spacing:1px; }
  .acimg { flex:1; min-width:0; height:96px; object-fit:cover; border-radius:7px; border:1px solid #233247; }
  .photos { flex:1; display:flex; gap:8px; }
  .sec { font-size:10px; letter-spacing:3px; color:#6b7890; margin:14px 30px 6px; }
  .leg { padding:13px 30px; border-bottom:1px solid #1a2638; }
  .leghd { display:flex; justify-content:space-between; align-items:baseline; }
  .legno { font-size:11px; letter-spacing:2px; color:#c4ced9; font-weight:700; }
  .legmeta { font-size:10px; color:#8a98ad; }
  .legroute { display:flex; align-items:center; gap:10px; margin:8px 0; }
  .apt { font-size:18px; font-weight:600; color:#fff; }
  .aptn { font-size:10px; color:#8a98ad; } .aptt { font-size:10px; color:#8a98ad; margin-top:2px; }
  .line { flex:1; height:1px; background:linear-gradient(90deg,#38bdf8,#2a3852); position:relative; }
  .plane { position:absolute; right:0; top:-8px; color:#38bdf8; }
  .crew { display:flex; flex-wrap:wrap; gap:8px 18px; margin:6px 0; }
  .crl { font-size:9px; letter-spacing:1px; color:#6b7890; } .crn { font-size:12px; color:#e8edf4; }
  .fbos { display:flex; gap:14px; margin-top:6px; }
  .fbo { flex:1; background:#0e1622; border:1px solid #1a2638; border-radius:7px; padding:8px 10px; }
  .fbol { font-size:9px; letter-spacing:1px; color:#6b7890; } .fbon { font-size:12px; color:#fff; font-weight:600; margin-top:2px; } .fboa { font-size:10px; color:#8a98ad; }
  #map { margin:14px 30px; height:200px; border-radius:9px; border:1px solid #233247; background:#0a0f18; }
  .nomap { display:flex; height:100%; align-items:center; justify-content:center; color:#5b6b82; font-size:12px; }
  .wxwrap { margin:0 30px; display:flex; flex-direction:column; gap:10px; }
  .wx { border:1px solid #1a2638; border-radius:8px; padding:10px 12px; background:#0e1622; }
  .wxa { font-size:12px; color:#fff; font-weight:600; margin-bottom:6px; }
  .wxd { display:flex; gap:10px; flex-wrap:wrap; }
  .wxday { flex:1; min-width:90px; text-align:center; border:1px solid #1a2638; border-radius:6px; padding:6px; }
  .wxdt { font-size:10px; color:#8a98ad; } .wxc { font-size:11px; color:#cfe0f5; margin:2px 0; } .wxt { font-size:12px; color:#fff; font-weight:600; }
  .webbar { display:flex; justify-content:flex-end; padding:10px 30px 0; }
  .webbtn { font-size:12px; padding:8px 14px; border-radius:8px; background:#1a2436; border:1px solid #8893a5; color:#e8edf4; text-decoration:none; }
  .foot { padding:18px 30px 30px; font-size:9px; color:#5b6b82; }
</style></head>
<body><div class="page">
  ${web && vm.pdfUrl ? `<div class="webbar"><a class="webbtn" href="${esc(vm.pdfUrl)}">Download PDF</a></div>` : ''}
  <div class="hdr">
    <div>${LOGO_DATA_URI ? `<img class="logo" src="${LOGO_DATA_URI}" alt="Exjet">` : '<div class="tail">EXJET</div>'}
      <div class="addr">4250 Execuair Street, Suite G · Orlando, FL 32827<br>+1 (407) 677-7792</div></div>
    <div class="qmeta"><div class="qlabel">TRIP SHEET</div>
      <div style="margin-top:10px">Trip <span style="color:#fff;font-weight:600">${esc(vm.tripNumber || '—')}</span><br>Quote ${esc(vm.quoteNumber || '—')}<br>${esc(vm.preparedOn || '')}</div></div>
  </div>
  <div class="rule"></div>
  <div class="prep">PREPARED FOR<br><span class="nm">${esc(cl.name || cl.company || '—')}</span>${cl.company && cl.name ? ` · ${esc(cl.company)}` : ''}${cl.address ? `<br>${esc(cl.address)}` : ''}</div>
  <div class="hero">
    <div style="flex:0 0 200px"><div class="tail">${esc(vm.tail || '')}</div><div class="type">${esc(vm.aircraftType || '')}</div>
      ${vm.maxPax ? `<div style="font-size:11px;color:#8a98ad;margin-top:8px">Max ${esc(vm.maxPax)} passengers</div>` : ''}</div>
    <div class="photos">${photoImg(photos.interior, 'interior')}${photoImg(photos.exterior, 'exterior')}${photoImg(photos.cabin, 'cabin')}</div>
  </div>
  <div class="sec">ITINERARY &amp; CREW</div>
  ${vm.legs.map(legBlock).join('')}
  <div id="map"></div>
  ${weatherBlock(vm.weather)}
  <div class="foot">Generated ${esc(vm.preparedOn || '')} · Exjet Aviation · Operational document.</div>
</div>
<script>${mapScript(vm)}</script>
</body></html>`;
}
