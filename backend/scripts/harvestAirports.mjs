import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const out = {};
const add = (icao, loc) => {
  if (!icao || !loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return;
  out[String(icao).trim().toUpperCase()] = { lat: loc.lat, lng: loc.lng };
};

let from = 0;
for (;;) {
  const { data, error } = await sb
    .from('scheduling_legs').select('lf_synced_snapshot')
    .eq('origin', 'levelflight').range(from, from + 999);
  if (error) throw error;
  if (!data?.length) break;
  for (const r of data) {
    const s = r.lf_synced_snapshot || {};
    add(s.departure?.airport, s._calc?.from?.location);
    add(s.arrival?.airport, s._calc?.to?.location);
  }
  if (data.length < 1000) break;
  from += 1000;
}

const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
const dir = fileURLToPath(new URL('../src/scheduling/data/', import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(dir + 'airports.json', JSON.stringify(sorted, null, 0) + '\n');
console.log(`Wrote ${Object.keys(sorted).length} airports to src/scheduling/data/airports.json`);
