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
