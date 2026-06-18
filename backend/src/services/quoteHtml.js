// backend/src/services/quoteHtml.js
// Renders a quote view-model to a self-contained "Midnight" HTML document used for
// BOTH the dashboard iframe preview and the Puppeteer PDF (single source of truth).
import { LOGO_DATA_URI, aircraftPhotos } from '../assets/quote/assets.js';
import { QUOTE_TERMS_HTML } from './quoteTerms.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 }));
const fmtDT = (ms) => (ms == null ? '' : new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));

function legRow(leg, i) {
  return `<div class="leg">
    <div class="legno">${i + 1}</div>
    <div class="legdate">${esc(fmtDT(leg.depTime))}</div>
    <div class="legroute">
      <div><div class="apt">${esc(leg.from)}</div></div>
      <div class="line"><span class="plane">&#9992;</span></div>
      <div style="text-align:right"><div class="apt">${esc(leg.to)}</div></div>
    </div>
    <div class="legmeta">${leg.pax != null ? esc(leg.pax) + ' PAX' : ''}<br>${[leg.eft ? esc(leg.eft) : '', leg.distance != null ? esc(leg.distance) + ' nm' : ''].filter(Boolean).join(' · ')}</div>
  </div>`;
}

function mapScript(viewModel) {
  const pts = viewModel.legs
    .filter((l) => l.fromLatLng && l.toLatLng)
    .map((l) => [l.fromLatLng, l.toLatLng]);
  return `
    const segs = ${JSON.stringify(pts)};
    if (segs.length) {
      const map = L.map('map', { zoomControl: false, attributionControl: false });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19 }).addTo(map);
      const all = [];
      segs.forEach((s) => {
        L.polyline(s, { color: '#38bdf8', weight: 2, opacity: 0.85 }).addTo(map);
        s.forEach((p) => { L.circleMarker(p, { radius: 4, color: '#fff', fillColor: '#38bdf8', fillOpacity: 1 }).addTo(map); all.push(p); });
      });
      map.fitBounds(L.latLngBounds(all), { padding: [24, 24] });
      window.__mapReady = false;
      map.whenReady(() => setTimeout(() => { window.__mapReady = true; }, 600));
    } else { window.__mapReady = true; document.getElementById('map').innerHTML = '<div class="nomap">Route map unavailable</div>'; }
  `;
}

export function renderQuoteHtml(vm, { print = false } = {}) {
  const photos = aircraftPhotos(vm.tail);
  const photoImg = (src, alt) => src ? `<img src="${src}" alt="${alt}" class="acimg">` : '';
  return `<!doctype html><html><head><meta charset="utf-8">
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
  .hero { display:flex; gap:18px; padding:22px 30px; align-items:center; }
  .tail { font-size:30px; font-weight:700; color:#fff; }
  .type { font-size:12px; color:#c4ced9; letter-spacing:1px; }
  .chips span { font-size:10px; border:1px solid #2a3852; border-radius:20px; padding:3px 10px; color:#cfe0f5; margin-right:6px; }
  .acimg { flex:1; min-width:0; height:96px; object-fit:cover; border-radius:7px; border:1px solid #233247; }
  .photos { flex:1; display:flex; gap:8px; }
  .sec { font-size:10px; letter-spacing:3px; color:#6b7890; margin:0 30px 6px; }
  .leg { display:flex; align-items:center; gap:16px; padding:13px 30px; border-bottom:1px solid #1a2638; }
  .legno { width:18px; color:#c4ced9; font-weight:700; }
  .legdate { width:130px; font-size:11px; color:#8a98ad; }
  .legroute { flex:1; display:flex; align-items:center; gap:10px; }
  .apt { font-size:18px; font-weight:600; color:#fff; }
  .line { flex:1; height:1px; background:linear-gradient(90deg,#38bdf8,#2a3852); position:relative; }
  .plane { position:absolute; right:0; top:-8px; color:#38bdf8; }
  .legmeta { width:90px; text-align:right; font-size:10px; color:#8a98ad; }
  #map { margin:14px 30px; height:170px; border-radius:9px; border:1px solid #233247; background:#0a0f18; }
  .nomap { display:flex; height:100%; align-items:center; justify-content:center; color:#5b6b82; font-size:12px; }
  .total { display:flex; justify-content:space-between; align-items:center; margin:0 30px; padding:16px 22px; border-radius:9px; background:linear-gradient(90deg,#1a2436,#0c1422); border:1px solid #8893a5; }
  .total .l { font-size:12px; letter-spacing:3px; color:#c4ced9; } .total .v { font-size:28px; font-weight:700; color:#fff; }
  .terms { margin:14px 30px 0; } .terms details { border:1px solid #243149; border-radius:9px; background:#0e1622; }
  .terms summary { cursor:pointer; list-style:none; padding:13px 16px; font-size:11px; letter-spacing:2px; color:#c4ced9; }
  .terms .body { padding:2px 16px 16px; border-top:1px solid #1a2638; font-size:10px; line-height:1.6; color:#aeb9c9; }
  .terms .t-h { color:#e8edf4; font-weight:600; margin:12px 0 3px; }
  .sign { display:flex; gap:24px; padding:18px 30px 10px; } .sign div { flex:1; } .sign .ln { height:1px; background:#33425c; } .sign .lbl { font-size:10px; color:#8a98ad; margin-top:5px; }
  .cta { margin:8px 30px 26px; padding:14px; text-align:center; border-radius:9px; background:linear-gradient(90deg,#cfd6e0,#aab4c2); color:#0b1018; font-weight:700; letter-spacing:3px; font-size:13px; text-decoration:none; display:block; }
  ${print ? '.terms{break-before:page;} .terms summary span:last-child{display:none;}' : ''}
</style></head>
<body><div class="page">
  <div class="hdr">
    <div>${LOGO_DATA_URI ? `<img class="logo" src="${LOGO_DATA_URI}" alt="Exjet">` : '<div class="tail">EXJET</div>'}
      <div class="addr">4250 Execuair Street, Suite G · Orlando, FL 32827<br>+1 (407) 677-7792</div></div>
    <div class="qmeta"><div class="qlabel">CHARTER QUOTE</div>
      <div style="margin-top:10px">Quote <span style="color:#fff;font-weight:600">${esc(vm.quoteNumber || '—')}</span><br>${esc(vm.preparedBy || '')}<br>${esc(vm.preparedOn || '')}</div></div>
  </div>
  <div class="rule"></div>
  <div class="hero">
    <div style="flex:0 0 200px"><div class="tail">${esc(vm.tail || '')}</div><div class="type">${esc(vm.aircraftType || '')}</div>
      ${vm.maxPax ? `<div style="font-size:11px;color:#8a98ad;margin-top:8px">Max ${esc(vm.maxPax)} passengers</div>` : ''}
      <div class="chips" style="margin-top:10px">${(vm.amenities || []).map((a) => `<span>${esc(a)}</span>`).join('')}</div></div>
    <div class="photos">${photoImg(photos.interior, 'interior')}${photoImg(photos.exterior, 'exterior')}${photoImg(photos.cabin, 'cabin')}</div>
  </div>
  <div class="sec">ITINERARY</div>
  ${vm.legs.map(legRow).join('')}
  <div id="map"></div>
  <div class="total"><span class="l">TOTAL</span><span class="v">${money(vm.total)}</span></div>
  <div class="sign"><div><div class="ln"></div><div class="lbl">Accepted by</div></div><div><div class="ln"></div><div class="lbl">Print name</div></div><div style="flex:0 0 130px"><div class="ln"></div><div class="lbl">Date</div></div></div>
  ${vm.acceptUrl ? `<a class="cta" href="${esc(vm.acceptUrl)}">REQUEST TO BOOK &#8594;</a>` : '<div class="cta" style="opacity:.5">BOOKING LINK UNAVAILABLE</div>'}
  <div class="terms"><details ${print ? 'open' : ''}><summary><span>TERMS &amp; CONDITIONS</span><span style="float:right;color:#8893a5">tap to expand &#9662;</span></summary><div class="body">${QUOTE_TERMS_HTML}</div></details></div>
</div>
<script>${mapScript(vm)}</script>
</body></html>`;
}
