// backend/src/services/adsbStore.js
// Soft-failing persistence for ADS-B position history. If Supabase isn't
// configured, every function no-ops (returns null/[]/0) so the recorder and
// endpoints keep working without it. Same pattern as agent/reviewStore.js.

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

let _client = null;
function getClient() {
  if (_client !== null) return _client || null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { _client = false; return null; }
  try { _client = createClient(url, key); return _client; }
  catch (e) { console.warn('[adsbStore] client init failed (soft):', e.message); _client = false; return null; }
}

// rows: [{ registration, lat, lon, altitude_ft, on_ground, t (ISO string) }]
export async function savePositions(rows) {
  if (!rows.length) return 0;
  const client = getClient();
  if (!client) return 0;
  try {
    const { error } = await client.from('adsb_positions').insert(rows);
    if (error) { console.warn('[adsbStore] insert failed (soft):', error.message); return 0; }
    return rows.length;
  } catch (e) { console.warn('[adsbStore] insert error (soft):', e?.message || e); return 0; }
}

// Delete rows older than `cutoffIso`. Returns true on success (best-effort).
export async function pruneOld(cutoffIso) {
  const client = getClient();
  if (!client) return false;
  try {
    const { error } = await client.from('adsb_positions').delete().lt('t', cutoffIso);
    if (error) { console.warn('[adsbStore] prune failed (soft):', error.message); return false; }
    return true;
  } catch (e) { console.warn('[adsbStore] prune error (soft):', e?.message || e); return false; }
}

// All positions for one registration in [startIso, endIso], oldest first.
// Returns [{ lat, lon, t (epoch ms), on_ground }].
// Recent flight trails from the PERSISTED firehose (survives server restarts, unlike the
// in-memory trail). Returns { registration: [[lat,lon],...] } for each tail, clipped to the
// most-recent contiguous segment (split at gaps > gapMs = a separate earlier flight), so the
// map shows the current flight's path rather than stitching the prior trip onto it.
export async function queryRecentTrails(sinceIso, gapMs = 30 * 60 * 1000) {
  const client = getClient();
  if (!client) return {};
  try {
    const { data, error } = await client
      .from('adsb_positions')
      .select('registration, lat, lon, t')
      .gte('t', sinceIso)
      .order('t', { ascending: false }) // newest first, so .limit keeps the MOST RECENT rows
      .limit(8000);                     // (ascending + limit would drop everything past the oldest 8000)
    if (error) { console.warn('[adsbStore] queryRecentTrails failed (soft):', error.message); return {}; }
    const byReg = {};
    for (const r of data || []) (byReg[r.registration] ||= []).push({ lat: r.lat, lon: r.lon, t: Date.parse(r.t) });
    const out = {};
    for (const [reg, pts] of Object.entries(byReg)) {
      pts.reverse(); // restore chronological order (query returned newest-first) for the gap scan + polyline
      let segStart = 0;
      for (let i = 1; i < pts.length; i++) if (pts[i].t - pts[i - 1].t > gapMs) segStart = i;
      const seg = pts.slice(segStart);
      if (seg.length >= 2) out[reg] = seg.map((p) => [p.lat, p.lon]);
    }
    return out;
  } catch (e) { console.warn('[adsbStore] queryRecentTrails error (soft):', e?.message || e); return {}; }
}

// Most recent firehose fix per registration — the last-known position when there's no
// live fix, so the map can show where the plane actually last was instead of snapping to
// its scheduled arrival. { reg: { lat, lon, on_ground, t (ms) } }. Soft: {} on any miss.
export async function getLastPositions(regs) {
  const ids = (regs || []).filter(Boolean);
  const client = getClient();
  if (!client || !ids.length) return {};
  const out = {};
  await Promise.all(ids.map(async (reg) => {
    try {
      const { data, error } = await client
        .from('adsb_positions')
        .select('lat, lon, on_ground, t')
        .eq('registration', reg)
        .order('t', { ascending: false })
        .limit(1);
      if (error) return;
      const r = data?.[0];
      if (r) out[reg] = { lat: r.lat, lon: r.lon, on_ground: r.on_ground, t: Date.parse(r.t) };
    } catch { /* soft */ }
  }));
  return out;
}

export async function queryTrack(registration, startIso, endIso) {
  const client = getClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from('adsb_positions')
      .select('lat, lon, t, on_ground')
      .eq('registration', registration)
      .gte('t', startIso).lte('t', endIso)
      .order('t', { ascending: true });
    if (error) { console.warn('[adsbStore] queryTrack failed (soft):', error.message); return []; }
    return (data || []).map((r) => ({ lat: r.lat, lon: r.lon, t: Date.parse(r.t), on_ground: r.on_ground }));
  } catch (e) { console.warn('[adsbStore] queryTrack error (soft):', e?.message || e); return []; }
}
