// backend/src/scheduling/lfNormalize.js
//
// Pure normalizers for LevelFlight payloads, ported from the proven exjet-ingest
// ETL. LevelFlight returns Mongo-style EJSON (`{ $oid }`) and timestamps in mixed
// forms (epoch ms, epoch sec, ISO strings, numeric strings). These turn them into
// plain strings / ISO timestamps for our Postgres columns.

// Extract an ObjectId string from LevelFlight's many id shapes.
export function oidToStr(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object' && typeof v.$oid === 'string') return v.$oid;
  return null;
}

// Convert a LevelFlight timestamp to an ISO string safe for a timestamptz column.
// Accepts epoch ms, epoch sec, ISO strings, numeric strings, and Date objects.
// Returns null when absent or unparseable.
export function toIsoTimestamp(v) {
  if (v === null || v === undefined) return null;

  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    if (s.includes('T') || s.includes('-') || s.includes(':')) {
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    if (/^\d+$/.test(s)) return toIsoTimestamp(Number(s));
    return null;
  }

  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    let ms = v;
    if (v > 0 && v < 1e11) ms = v * 1000; // likely seconds, not ms
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  if (v instanceof Date) {
    return isNaN(v.getTime()) ? null : v.toISOString();
  }

  return null;
}

// Unwrap a LevelFlight list response that may be a bare array or wrapped under a
// known key (e.g. { legs: [...] }). Throws on an unexpected shape.
export function unwrapArray(payload, keys) {
  if (Array.isArray(payload)) return payload;
  for (const k of keys) {
    if (Array.isArray(payload?.[k])) return payload[k];
  }
  throw new Error('unexpected LevelFlight list shape: ' + JSON.stringify(payload).slice(0, 300));
}
