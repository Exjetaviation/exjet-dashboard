// backend/src/services/lfUserDirectory.js
//
// Cached LevelFlight user directory: oid -> { email, name }. Crew on leg
// snapshots carry only an oid, so this is the authoritative email source.
import { oidToStr } from '../scheduling/lfNormalize.js';
import { getUsers, getPilotsList, getAttendants } from './levelflight.js';

const rowsOf = (list) =>
  Array.isArray(list) ? list : (list?.users || list?.pilots || list?.attendants || list?.data || []);

// Pure: merge raw LF user lists into a Map(oid -> { email, name }).
export function indexUsers(rawLists = []) {
  const map = new Map();
  for (const list of rawLists) {
    for (const u of rowsOf(list)) {
      const oid = oidToStr(u?._id?.$oid) || oidToStr(u?._id) || oidToStr(u?.oid) || oidToStr(u?.id);
      if (!oid) continue;
      const email = u?.email || u?.emailAddress || u?.primaryEmail || null;
      const name = [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || u?.name || null;
      const prev = map.get(oid);
      if (!prev || (!prev.email && email)) map.set(oid, { email: email || null, name: name || prev?.name || null });
    }
  }
  return map;
}

let _cache = { at: 0, map: new Map() };
const TTL_MS = 30 * 60 * 1000;

// Cached index. Best-effort: if a list fetch fails, the others still contribute;
// a fully-failed refresh keeps the last good cache.
export async function getUserIndex(nowMs = Date.now()) {
  if (nowMs - _cache.at < TTL_MS && _cache.map.size) return _cache.map;
  const lists = await Promise.all([
    getUsers().catch(() => null),
    getPilotsList().catch(() => null),
    getAttendants().catch(() => null),
  ]);
  const map = indexUsers(lists.filter(Boolean));
  if (map.size) _cache = { at: nowMs, map };
  return _cache.map;
}
