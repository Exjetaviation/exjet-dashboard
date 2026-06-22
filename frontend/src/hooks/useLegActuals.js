import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

// Polls persisted actual departure/arrival times for legs whose SCHEDULED departure
// falls in [rangeStart, rangeEnd]. Returns { actuals } keyed by leg id:
//   { [legId]: { actualDep, actualArr, depSource, arrSource } }   (ms, or null)
// Settled delays (after a flight lands / after a refresh) come from here; the live
// in-progress overlay uses the ADS-B feed (useAdsb) instead. Refetches when the
// visible range changes and every `intervalMs`.
export function useLegActuals(rangeStart, rangeEnd, intervalMs = 60000) {
  const [actuals, setActuals] = useState({});
  useEffect(() => {
    if (rangeStart == null || rangeEnd == null) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const r = await apiFetch(`/api/adsb/actuals?from=${Math.floor(rangeStart)}&to=${Math.floor(rangeEnd)}`);
        const j = await r.json();
        if (alive && j.actuals) setActuals(j.actuals);
      } catch { /* keep last known */ }
    };
    tick();
    const timer = setInterval(tick, intervalMs);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
  }, [rangeStart, rangeEnd, intervalMs]);
  return { actuals };
}
