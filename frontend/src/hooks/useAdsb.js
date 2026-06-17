import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';

// Polls our own backend proxy for live ADS-B positions. Uses apiFetch (same as
// useApi) so the Supabase login token + API base URL are attached — every /api
// route on the backend is behind requireAuth. When includeTrail is true, the
// same tick also pulls the rolling position history.
export function useAdsb(intervalMs = 20000, includeTrail = false) {
  const [positions, setPositions] = useState({});
  const [trails, setTrails] = useState({});
  const [updatedAt, setUpdatedAt] = useState(null);
  const timer = useRef(null);
  // Read the latest includeTrail inside the interval without re-creating it.
  const includeTrailRef = useRef(includeTrail);
  useEffect(() => { includeTrailRef.current = includeTrail; }, [includeTrail]);
  // One-shot trail fetch the moment the toggle turns on (so we don't wait for
  // the next poll); clear trails when it turns off.
  useEffect(() => {
    if (!includeTrail) { setTrails({}); return; }
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch('/api/adsb/trail');
        const j = await r.json();
        if (alive && j?.trails) setTrails(j.trails);
      } catch {}
    })();
    return () => { alive = false; };
  }, [includeTrail]);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await apiFetch('/api/adsb/positions');
        const j = await r.json();
        if (alive && j.positions) { setPositions(j.positions); setUpdatedAt(Date.now()); }
      } catch { /* keep last known */ }
      if (includeTrailRef.current) {
        try {
          const tr = await apiFetch('/api/adsb/trail');
          const tj = await tr.json();
          if (alive && tj.trails) setTrails(tj.trails);
        } catch { /* keep last known */ }
      }
    };
    tick();
    timer.current = setInterval(tick, intervalMs);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearInterval(timer.current); document.removeEventListener('visibilitychange', onVis); };
  }, [intervalMs]);
  return { positions, trails, updatedAt };
}

// One-shot fetch of a single aircraft's previous flights (rolling `days`).
// Returns { tail, days, flights: [{ legId, from, to, depTime, arrTime, track }] }
// or { flights: [] } on failure.
export async function fetchPreviousFlights(tail, days = 3) {
  try {
    const r = await apiFetch(`/api/adsb/previous-flights?tail=${encodeURIComponent(tail)}&days=${days}`);
    const j = await r.json();
    return j?.flights ? j : { flights: [] };
  } catch {
    return { flights: [] };
  }
}

// One-shot fetch of ONE flight's track. Returns the permanent snapshot if stored,
// else a live clip when tail/dep are provided. Shape:
// { legId, source: 'snapshot'|'live'|'none', track: [[lat,lon],...], from, to, depTime, arrTime }
export async function fetchFlightTrack(legId, { tail, dep, arr } = {}) {
  try {
    const qs = new URLSearchParams();
    if (tail) qs.set('tail', tail);
    if (dep) qs.set('dep', String(dep));
    if (arr) qs.set('arr', String(arr));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const r = await apiFetch(`/api/adsb/flight-track/${encodeURIComponent(legId)}${suffix}`);
    const j = await r.json();
    return j?.track ? j : { track: [], source: 'none' };
  } catch {
    return { track: [], source: 'none' };
  }
}
