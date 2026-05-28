import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';

// Polls our own backend proxy for live ADS-B positions. Uses apiFetch (same as
// useApi) so the Supabase login token + API base URL are attached — every /api
// route on the backend is behind requireAuth.
export function useAdsb(intervalMs = 20000) {
  const [positions, setPositions] = useState({});
  const [updatedAt, setUpdatedAt] = useState(null);
  const timer = useRef(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await apiFetch('/api/adsb/positions');
        const j = await r.json();
        if (alive && j.positions) { setPositions(j.positions); setUpdatedAt(Date.now()); }
      } catch { /* keep last known */ }
    };
    tick();
    timer.current = setInterval(tick, intervalMs);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearInterval(timer.current); document.removeEventListener('visibilitychange', onVis); };
  }, [intervalMs]);
  return { positions, updatedAt };
}
