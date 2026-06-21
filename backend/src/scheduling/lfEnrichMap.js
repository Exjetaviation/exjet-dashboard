// backend/src/scheduling/lfEnrichMap.js
//
// Pure mapping from LevelFlight customer data to our scheduling_people shape.
// No DB / network imports, so it's unit-testable in isolation (mirrors the
// perfProfile / perfCalibrate split).

// LevelFlight document `type` -> our person columns (per /api/customer/documentCodes).
export const DOC_TYPE = {
  0: { num: 'passport_number', exp: 'passport_expiry', country: 'passport_country' }, // Passport
  1: { num: 'green_card_number', exp: 'green_card_expiry' },                          // Permanent Resident Card
};

// Epoch-ms / ISO / EJSON {$date} -> YYYY-MM-DD, dropping corrupt out-of-range years.
export function toDate(v) {
  if (v == null) return null;
  const raw = v?.$date ?? v;
  const ms = typeof raw === 'number' ? raw : Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  const y = new Date(ms).getUTCFullYear();
  if (y < 1900 || y > 2200) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

// LevelFlight customer DETAIL -> a scheduling_people patch (only fields LF provides).
export function mapDetailToPatch(c) {
  const p = {};
  if (!c) return p;
  const dob = toDate(c.birthday); if (dob) p.dob = dob;
  const w = Number(c.weight); if (Number.isFinite(w)) p.weight_lbs = w;
  if (c.citizenship) p.citizenship = c.citizenship;
  if (c.gender) p.gender = c.gender;
  for (const doc of c.documents || []) {
    const map = DOC_TYPE[doc?.type];
    if (!map) continue;
    if (doc.number) p[map.num] = String(doc.number);
    if (map.exp) { const e = toDate(doc.expiry); if (e) p[map.exp] = e; }
    if (map.country && doc.country) p[map.country] = doc.country;
  }
  return p;
}

// LevelFlight customer LIST record -> a new scheduling_people row (null if nameless).
export function mapListToPerson(c) {
  const name = [c?.firstName, c?.lastName].map((s) => (s || '').trim()).filter(Boolean).join(' ');
  if (!name) return null;
  return {
    lf_oid: c._id?.$oid || c._id || null,
    first_name: (c.firstName || '').trim() || null,
    middle_name: (c.middleName || '').trim() || null,
    last_name: (c.lastName || '').trim() || null,
    email: c.email || null,
    origin: 'levelflight',
  };
}

export const extFor = (ct) => /pdf/.test(ct) ? 'pdf' : /png/.test(ct) ? 'png' : /jpe?g/.test(ct) ? 'jpg' : /tiff?/.test(ct) ? 'tif' : 'bin';
export const safeDocName = (s) => String(s || 'LF scan').replace(/[^a-zA-Z0-9._ -]/g, '_').trim().slice(0, 60) || 'LF scan';
