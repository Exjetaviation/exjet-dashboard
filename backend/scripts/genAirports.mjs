// Regenerate backend/src/scheduling/data/airports.json from the public-domain
// OurAirports dataset (ICAO/GPS/IATA -> {lat,lng}). Run: node backend/scripts/genAirports.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
const res = await fetch('https://davidmegginson.github.io/ourairports-data/airports.csv');
const rows = (await res.text()).split(/\r?\n/);
const parse = (line) => { const out=[]; let cur='',q=false; for(let i=0;i<line.length;i++){const c=line[i]; if(q){if(c==='"'){if(line[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=c;} else {if(c===','){out.push(cur);cur='';}else if(c==='"')q=true;else cur+=c;}} out.push(cur); return out; };
const H = parse(rows[0]); const ix=(n)=>H.indexOf(n);
const iType=ix('type'),iIdent=ix('ident'),iLat=ix('latitude_deg'),iLng=ix('longitude_deg'),iGps=ix('gps_code'),iIata=ix('iata_code');
const SKIP=new Set(['closed','heliport','seaplane_base','balloonport']);
const r4=(x)=>Math.round(x*1e4)/1e4, okI=(s)=>/^[A-Z0-9]{3,4}$/.test(s), okA=(s)=>/^[A-Z]{3}$/.test(s);
const out={};
for(let i=1;i<rows.length;i++){ if(!rows[i])continue; const f=parse(rows[i]); if(SKIP.has(f[iType]))continue;
  const lat=parseFloat(f[iLat]),lng=parseFloat(f[iLng]); if(!Number.isFinite(lat)||!Number.isFinite(lng))continue;
  const c={lat:r4(lat),lng:r4(lng)};
  const ident=(f[iIdent]||'').toUpperCase(),gps=(f[iGps]||'').toUpperCase(),iata=(f[iIata]||'').toUpperCase();
  if(okI(ident))out[ident]=c; if(okI(gps)&&!out[gps])out[gps]=c; if(okA(iata)&&!out[iata])out[iata]=c;
}
mkdirSync('backend/src/scheduling/data',{recursive:true});
writeFileSync('backend/src/scheduling/data/airports.json', JSON.stringify(out));
console.log('airports written:', Object.keys(out).length);
