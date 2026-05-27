// Best-effort grounding check — verifies that concrete identifiers the agent
// states in its answer actually appeared in an authorized source. Not a fact
// checker; it catches fabricated tail numbers and ICAO codes.
//
// Matching is case-sensitive on purpose: in real operational text tail numbers
// and ICAO codes are written in all caps (N408JS, KFXE), so uppercasing the
// answer before regex matching would scoop up common English words like
// "from", "like", "tail" as fake ICAOs.

const N_NUMBER_RE = /\bN[0-9][0-9A-Z]{0,4}\b/g;   // FAA registrations
const ICAO_RE     = /\b[A-Z]{4}\b/g;              // 4-letter airport codes

// All-caps 4-letter tokens that show up in operational writing but aren't
// airport codes. Extend if false positives surface in real use.
const ICAO_STOPWORDS = new Set([
  'METAR', 'TAF', 'NOTAM', 'ICAO', 'IATA', 'CARGO', 'CREW', 'FUEL',
  'ETOPS', 'PART', 'NOTE', 'OPEN', 'CAVU', 'WIND', 'CFR',
]);

function uniq(matches) {
  return [...new Set(matches)];
}

function extractIdentifiers(text) {
  if (!text || typeof text !== 'string') return { tails: [], icaos: [] };
  const tails = uniq(text.match(N_NUMBER_RE) || []);
  const icaos = uniq((text.match(ICAO_RE) || []).filter((m) => !ICAO_STOPWORDS.has(m)));
  return { tails, icaos };
}

function buildCorpus(toolCalls, extraSources = []) {
  const parts = [];
  if (Array.isArray(toolCalls)) {
    for (const c of toolCalls) {
      try { parts.push(JSON.stringify(c.result || null)); } catch { /* skip */ }
    }
  }
  for (const s of extraSources) {
    if (typeof s === 'string' && s) parts.push(s);
  }
  return parts.join('\n');
}

/**
 * checkGrounding(answerText, toolCalls, options?)
 *
 * options.authorizedSources — extra authorized-source strings to include in
 * the corpus (e.g. the system prompt, which lists the fleet). Identifiers
 * mentioned in any authorized source count as verified.
 */
export function checkGrounding(answerText, toolCalls, options = {}) {
  const { tails, icaos } = extractIdentifiers(answerText);
  const corpus = buildCorpus(toolCalls, options.authorizedSources || []);
  const unverified = [];
  for (const v of tails) {
    if (!corpus.includes(v)) unverified.push({ value: v, type: 'tail' });
  }
  for (const v of icaos) {
    if (!corpus.includes(v)) unverified.push({ value: v, type: 'icao' });
  }
  return {
    grounded: unverified.length === 0,
    unverified,
    checked: { tails, icaos },
  };
}
