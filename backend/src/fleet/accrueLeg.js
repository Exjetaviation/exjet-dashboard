// backend/src/fleet/accrueLeg.js
import { computeLegEntries } from './componentAccrual.js';
import { normReg } from '../services/adsbTrack.js';

// deps: { getAircraftByTail, listComponents, applyLedgerEntry }
export async function accrueLeg(deps, flightInfo, tail) {
  if (!flightInfo || flightInfo.status !== 'complete' || !tail) return 0;
  const ac = await deps.getAircraftByTail(normReg(tail));
  if (!ac) return 0;
  const comps = await deps.listComponents(ac.id);
  const entries = computeLegEntries(flightInfo, comps);
  for (const e of entries) await deps.applyLedgerEntry(e);
  return entries.length;
}
