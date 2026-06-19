// backend/src/scheduling/syncWorker.js
//
// Background worker that runs the scheduled-legs mirror on an interval, mirroring
// the existing startRecorder/startReconciler pattern. Opt-in: does nothing unless
// SCHEDULING_SYNC=on, so starting the backend doesn't hit LevelFlight until enabled.
import { runScheduledLegsSync } from './runScheduledLegsSync.js';
import { computeMonthStarts } from './syncWindow.js';
import { syncLf } from './syncLf.js';
import { syncDb } from './syncDb.js';
import { autoCloseCompletedTrips } from './autoClose.js';
import { calibratePerfProfiles } from './perfCalibrate.js';

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
let started = false;

export async function syncNow() {
  const now = new Date().toISOString();
  const monthStarts = computeMonthStarts(Date.now());
  const counts = await runScheduledLegsSync({ lf: syncLf, db: syncDb, now, monthStarts });
  // Close out released trips whose flight has completed (best-effort; never fails the sync).
  await autoCloseCompletedTrips(now).catch((e) => console.warn('[scheduling auto-close] failed:', e?.message || e));
  // Refresh the per-aircraft-type flight-time profile from history (best-effort).
  await calibratePerfProfiles().catch((e) => console.warn('[scheduling calibrate] failed:', e?.message || e));
  return counts;
}

export function startSyncWorker() {
  if (process.env.SCHEDULING_SYNC !== 'on') return; // opt-in
  if (started) return;
  started = true;
  const run = () =>
    syncNow().catch((e) => console.warn('[scheduling sync] failed:', e?.message || e));
  run();
  setInterval(run, SYNC_INTERVAL_MS);
}
