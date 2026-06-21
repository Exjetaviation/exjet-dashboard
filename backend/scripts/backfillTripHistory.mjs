// backend/scripts/backfillTripHistory.mjs
//
// One-time: widen the dispatch mirror to pull HISTORICAL trips into
// scheduling_trips/legs, so passengers can be linked to their full flight history
// (the recurring sync only covers a rolling -30/+90d window). Reuses the exact same
// tested sync pipeline (runScheduledLegsSync + syncLf/syncDb adapters).
//
// NOTE: this also makes those historical trips appear in the Schedule/Trips views.
// After running, re-run scripts/linkLfTrips.mjs to link passengers to the new trips.
//
// Run from backend/ (back-days defaults to 365; pass a number to override):
//   node scripts/backfillTripHistory.mjs           # 1 year back
//   node scripts/backfillTripHistory.mjs 1095       # 3 years back
import 'dotenv/config';
import { runScheduledLegsSync } from '../src/scheduling/runScheduledLegsSync.js';
import { computeMonthStarts } from '../src/scheduling/syncWindow.js';
import { syncLf } from '../src/scheduling/syncLf.js';
import { syncDb } from '../src/scheduling/syncDb.js';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');

const backDays = Math.max(1, parseInt(process.argv[2], 10) || 365);
const now = new Date().toISOString();
const monthStarts = computeMonthStarts(Date.now(), { backDays, fwdDays: 90 });
console.log(`Mirroring ${monthStarts.length} month buckets (back ${backDays}d, fwd 90d)…`);

// Process one month at a time with retry, so a transient network blip on one
// bucket doesn't abort the whole run. Idempotent (upserts by lf_oid), so safe.
const totals = { trips: 0, legs: 0, crew: 0 };
const failed = [];
for (const start of monthStarts) {
  const label = new Date(start).toISOString().slice(0, 7);
  let attempt = 0;
  for (;;) {
    try {
      const c = await runScheduledLegsSync({ lf: syncLf, db: syncDb, now, monthStarts: [start] });
      for (const k of Object.keys(totals)) totals[k] += (c?.[k] ?? c?.[`${k}Upserted`] ?? 0);
      process.stdout.write(`  ${label} ✓\n`);
      break;
    } catch (e) {
      if (++attempt >= 3) { console.warn(`  ${label} ✗ ${e.message}`); failed.push(label); break; }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}
console.log(`Done. ~${JSON.stringify(totals)}. Failed buckets: ${failed.length ? failed.join(', ') : 'none'}`);
console.log('Next: re-run  node scripts/linkLfTrips.mjs  to link passengers to the newly-mirrored trips.');
