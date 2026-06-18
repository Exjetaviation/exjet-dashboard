// backend/src/scheduling/freshness.js
//
// Pure: classify how fresh the mirror is from the last successful sync time.
// Operational cadence is "every few minutes", so default the stale threshold
// to 10 minutes. Drives the "Synced N min ago" indicator in the UI.
export function freshnessLabel(lastSuccessAt, now, staleAfterMs = 10 * 60 * 1000) {
  if (!lastSuccessAt) return { state: 'unknown', text: 'Never synced' };
  const ageMs = new Date(now).getTime() - new Date(lastSuccessAt).getTime();
  const mins = Math.floor(Math.max(ageMs, 0) / 60000);
  const text = mins < 1 ? 'Synced just now' : `Synced ${mins} min ago`;
  return { state: ageMs <= staleAfterMs ? 'fresh' : 'stale', text };
}
