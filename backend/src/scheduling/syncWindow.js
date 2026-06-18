// backend/src/scheduling/syncWindow.js
//
// Pure: compute the UTC first-of-month timestamps to fetch, covering the rolling
// window [now - backDays, now + fwdDays]. LevelFlight's /api/analytics/scheduledLegs
// returns one month per start timestamp, so we fetch one bucket per month touched.
const DAY_MS = 86400000;

export function computeMonthStarts(nowMs, { backDays = 30, fwdDays = 90 } = {}) {
  const startDate = new Date(nowMs - backDays * DAY_MS);
  const end = nowMs + fwdDays * DAY_MS;
  let y = startDate.getUTCFullYear();
  let m = startDate.getUTCMonth();
  const out = [];
  for (let t = Date.UTC(y, m, 1); t <= end; t = Date.UTC(y, m, 1)) {
    out.push(t);
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return out;
}
