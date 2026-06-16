// Pure helpers for NTSB import: decode NTSB codes, classify Part-135 relevance,
// and aggregate per-airport profiles. No I/O — imported by importNtsb.js and
// unit-tested in ntsbProfile.test.js.

/* ─────────────── code decoding ─────────────── */

export const DAMAGE = { DEST: 'Destroyed', SUBS: 'Substantial', MINR: 'Minor', NONE: 'None', UNK: 'Unknown' };
export const INJURY = { FATL: 'Fatal', SERS: 'Serious', MINR: 'Minor', NONE: 'None', UNK: 'Unknown' };
export const WEATHER = { VMC: 'VMC', IMC: 'IMC', UNK: 'Unknown' };
export const ENGINE = {
  REC: 'Reciprocating', TF: 'Turbofan', TP: 'Turboprop', TJ: 'Turbojet',
  TS: 'Turboshaft', GTFN: 'Geared Turbofan', ELEC: 'Electric', NONE: 'None', UNK: 'Unknown',
};

export function decode(map, code) {
  const c = String(code || '').trim();
  if (!c) return null;
  return map[c] || c;
}

// Phase_of_Flight is a numeric code in the Occurrences table. The data
// dictionary maps each code to a meaning like "Approach - VFR go-around"; the
// broad phase is the part before " - ". phaseMap is { code: meaning } loaded
// from the dictionary at import time.
export function broadPhase(code, phaseMap = {}) {
  const meaning = phaseMap[String(code || '').trim()];
  if (!meaning) return null;
  return String(meaning).split(' - ')[0].trim() || null;
}

/* ─────────────── Part-135 relevance ─────────────── */

// Makes whose single-engine reciprocating models are light GA, not comparable
// to Part 135 jet/turboprop ops.
const LIGHT_GA_MAKES = [
  'cessna', 'piper', 'cirrus', 'beech', 'mooney', 'diamond', 'grumman',
  'american', 'aeronca', 'maule', 'bellanca', 'luscombe', 'taylorcraft',
  'stinson', 'ercoupe', 'champion', 'vans', "van's", 'aviat', 'pilatus pc-6',
];

// Conservative exclusion: drop ONLY a clear light-GA piston single — single
// engine AND reciprocating AND a known light-GA make. Turbine (any), multi-
// engine, unknown engine, or unknown make → kept (ambiguous stays in).
// engineType is the DECODED value (e.g. "Reciprocating").
export function isLightGaPistonSingle({ make, number_of_engines, engine_type } = {}) {
  if (Number(number_of_engines) !== 1) return false;
  if (String(engine_type || '').toLowerCase() !== 'reciprocating') return false;
  const m = String(make || '').trim().toLowerCase();
  if (!m) return false;
  return LIGHT_GA_MAKES.some((x) => m.startsWith(x));
}

export function isPart135Relevant(rec) {
  return !isLightGaPistonSingle(rec);
}

/* ─────────────── damage pattern keywords ─────────────── */

// Ordered: first match per pattern wins. Scanned against probable_cause +
// narrative text.
const DAMAGE_PATTERNS = [
  { label: 'runway excursion', re: /runway excursion|overran|ran off the runway|veered off|excursion/i },
  { label: 'hard landing',     re: /hard landing|landed hard|firm landing/i },
  { label: 'CFIT/terrain',     re: /\bcfit\b|controlled flight into terrain|collision with terrain|impact with terrain|into terrain|mountainous/i },
  { label: 'wind shear',       re: /wind ?shear|microburst|gust|strong crosswind/i },
  { label: 'icing',            re: /\bicing\b|\bice\b|iced/i },
  { label: 'bird strike',      re: /bird ?strike|bird ingestion/i },
  { label: 'fuel',             re: /fuel exhaustion|fuel starvation|fuel contamination|ran out of fuel|\bfuel\b/i },
  { label: 'gear',             re: /landing gear|gear collapse|gear-up|gear up landing|wheels up/i },
];

// Return the set of pattern labels present in one event's text.
export function eventDamagePatterns(text) {
  const t = String(text || '');
  if (!t) return [];
  const out = [];
  for (const { label, re } of DAMAGE_PATTERNS) {
    if (re.test(t)) out.push(label);
  }
  return out;
}

/* ─────────────── aggregation ─────────────── */

// Top-N keys by frequency from an array of values (skips falsy/Unknown).
export function topN(values, n = 3) {
  const counts = new Map();
  for (const v of values) {
    const k = v == null ? '' : String(v).trim();
    if (!k || /^unknown$/i.test(k)) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

function plural(n, noun) { return `${n} ${noun}${n === 1 ? '' : 's'}`; }

// Human-readable warnings from aggregated stats. Each only fires at 2+.
export function buildPatternWarnings({ relevant = [], damageCounts = new Map(), phaseCounts = new Map(), imcCount = 0, fatalCount = 0 } = {}) {
  const out = [];

  const exc = damageCounts.get('runway excursion') || 0;
  if (exc >= 2) {
    const wet = relevant.filter((r) => (r._patterns || []).includes('runway excursion') && /^imc$/i.test(r.weather_condition || '')).length;
    out.push(wet >= 2 ? `${plural(exc, 'runway excursion')} recorded, ${wet} in IMC` : `${plural(exc, 'runway excursion')} recorded`);
  }
  const cfit = damageCounts.get('CFIT/terrain') || 0;
  if (cfit >= 2) out.push(`CFIT/terrain risk noted in ${plural(cfit, 'event')}`);

  const ice = damageCounts.get('icing') || 0;
  if (ice >= 2) out.push(`icing involved in ${plural(ice, 'event')}`);

  if (fatalCount >= 2) out.push(`${plural(fatalCount, 'fatal accident')} on record`);

  // Most common phase cluster among relevant events.
  const topPhase = [...phaseCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topPhase && topPhase[1] >= 2) out.push(`${plural(topPhase[1], 'event')} during ${String(topPhase[0]).toLowerCase()} phase`);

  if (imcCount >= 2) out.push(`${plural(imcCount, 'event')} in instrument conditions (IMC)`);

  return out;
}

// Build one ntsb_airport_profiles row from all raw rows at an airport.
// `rows` are decoded raw records (output of the importer's row shaper), each
// already carrying event_date, make, model, injury_severity, aircraft_damage,
// weather_condition, broad_phase_of_flight, narrative, probable_cause,
// number_of_engines, engine_type, ntsb_number, airport_name, state.
export function buildAirportProfile(airport_code, rows, dataThrough) {
  const sorted = [...rows].sort((a, b) => String(b.event_date || '').localeCompare(String(a.event_date || '')));
  // Clone relevant rows before annotating with _patterns so we never mutate the
  // raw row objects that get upserted into ntsb_raw (which has no such column).
  const relevant = sorted
    .filter(isPart135Relevant)
    .map((r) => ({ ...r, _patterns: eventDamagePatterns(`${r.probable_cause || ''} ${r.narrative || ''}`) }));

  const damageCounts = new Map();
  for (const r of relevant) for (const p of r._patterns) damageCounts.set(p, (damageCounts.get(p) || 0) + 1);
  const phaseCounts = new Map();
  for (const r of relevant) { const p = r.broad_phase_of_flight; if (p) phaseCounts.set(p, (phaseCounts.get(p) || 0) + 1); }
  const imcCount = relevant.filter((r) => /^imc$/i.test(r.weather_condition || '')).length;
  const fatalCount = relevant.filter((r) => /^fatal$/i.test(r.injury_severity || '')).length;

  const meta = sorted.find((r) => r.airport_name) || sorted[0] || {};

  return {
    airport_code,
    airport_name: meta.airport_name || null,
    state: meta.state || null,
    total_events: sorted.length,
    fatal_events: sorted.filter((r) => /^fatal$/i.test(r.injury_severity || '')).length,
    part135_relevant_events: relevant.length,
    top_phases: topN(relevant.map((r) => r.broad_phase_of_flight)),
    top_weather_conditions: topN(relevant.map((r) => r.weather_condition)),
    top_damage_patterns: [...damageCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k),
    recent_events: relevant.slice(0, 5).map((r) => ({
      date: r.event_date || null,
      make: r.make || null,
      model: r.model || null,
      phase: r.broad_phase_of_flight || null,
      severity: r.injury_severity || null,
      damage: r.aircraft_damage || null,
      ntsb_number: r.ntsb_number || null,
    })),
    pattern_warnings: buildPatternWarnings({ relevant, damageCounts, phaseCounts, imcCount, fatalCount }),
    last_event_date: sorted[0]?.event_date || null,
    data_through: dataThrough || null,
  };
}
