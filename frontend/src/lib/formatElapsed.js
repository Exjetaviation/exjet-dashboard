// Format an elapsed duration (ms). Under an hour -> "M:SS"; an hour or more ->
// "H:MM". null/negative -> "—". Used by the in-flight timer.
export function formatElapsed(ms) {
  if (ms == null || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h >= 1) return `${h}:${String(m).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
