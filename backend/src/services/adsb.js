import dotenv from 'dotenv';
dotenv.config();

const PROVIDERS = {
  airplanes_live: { // FREE, non-commercial only — prototyping
    base: 'https://api.airplanes.live/v2',
    regPath: (reg) => `/reg/${encodeURIComponent(reg)}`,
    headers: () => ({}),
  },
  adsbx_rapidapi: { // ADS-B Exchange via RapidAPI
    base: 'https://adsbexchange-com1.p.rapidapi.com/v2',
    regPath: (reg) => `/registration/${encodeURIComponent(reg)}/`,
    headers: () => ({
      'X-RapidAPI-Key': process.env.ADSB_API_KEY,
      'X-RapidAPI-Host': 'adsbexchange-com1.p.rapidapi.com',
    }),
  },
  adsbx_direct: { // ADS-B Exchange commercial gateway
    base: 'https://gateway.adsbexchange.com/api/aircraft/v2',
    regPath: (reg) => `/registration/${encodeURIComponent(reg)}/`,
    headers: () => ({ 'api-auth': process.env.ADSB_API_KEY }),
  },
};

const PROVIDER = PROVIDERS[process.env.ADSB_PROVIDER || 'airplanes_live'];
const FLEET = (process.env.ADSB_FLEET || 'N69FP,N408JS')
  .split(',').map(s => s.trim()).filter(Boolean);
const CACHE_TTL_MS = Number(process.env.ADSB_CACHE_TTL_MS || 20000);

let cache = { at: 0, data: {} };

function normalize(ac) {
  if (!ac) return null;
  const onGround = ac.alt_baro === 'ground';
  return {
    registration: ac.r || null,
    hex: ac.hex || null,
    callsign: (ac.flight || '').trim() || null,
    type: ac.t || null,
    lat: ac.lat ?? null,
    lon: ac.lon ?? null,
    altitudeFt: onGround ? 0 : (typeof ac.alt_baro === 'number' ? ac.alt_baro : null),
    onGround,
    groundSpeedKt: ac.gs ?? null,
    track: ac.track ?? ac.true_heading ?? null,
    secondsSincePosition: ac.seen_pos ?? ac.seen ?? null,
    source: 'adsb',
  };
}

async function fetchReg(reg) {
  const res = await fetch(PROVIDER.base + PROVIDER.regPath(reg), { headers: PROVIDER.headers() });
  if (!res.ok) throw new Error(`ADS-B ${reg} -> HTTP ${res.status}`);
  const json = await res.json();
  const ac = Array.isArray(json.ac) && json.ac.length ? json.ac[0] : null;
  return normalize(ac);
}

export async function getLivePositions() {
  const now = Date.now();
  if (now - cache.at < CACHE_TTL_MS) return cache.data;
  const out = {};
  for (const reg of FLEET) { // sequential: respects free-tier 1 req/sec
    try {
      const pos = await fetchReg(reg);
      if (pos && pos.lat != null && pos.lon != null) out[reg] = pos;
    } catch (e) { console.warn('[adsb]', e.message); }
  }
  cache = { at: now, data: out };
  return out;
}
