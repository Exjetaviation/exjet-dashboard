// Voyage AI embedding client — thin HTTP wrapper, no SDK dep.
//
// Usage:
//   import { embed } from './embeddings.js';
//   const vectors = await embed(['some text', 'another']);
//   // vectors[i] is aligned to texts[i].
//
// Auto-batches into the API's 128-input limit. Model selectable via the
// VOYAGE_MODEL env var; defaults to voyage-3 (1024-dim, matches the
// manual_chunks.embedding column).

import 'dotenv/config';

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_BATCH_MAX = 128;
const DEFAULT_MODEL = 'voyage-3';
const DEFAULT_TIMEOUT_MS = 60000;

function chunkArray(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Single-batch call. `inputType` is 'document' for ingestion or 'query'
// for retrieval — Voyage tunes the embedding distribution for each.
async function callVoyage(batch, { model, inputType, apiKey, timeoutMs }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: batch,
        model,
        ...(inputType ? { input_type: inputType } : {}),
      }),
      signal: ctrl.signal,
    });
    const body = await res.text();
    let parsed;
    try { parsed = body ? JSON.parse(body) : null; } catch { parsed = null; }
    if (!res.ok) {
      const detail = parsed?.error?.message || parsed?.detail || body.slice(0, 200);
      const err = new Error(`Voyage HTTP ${res.status}: ${detail}`);
      err.status = res.status;
      throw err;
    }
    const data = Array.isArray(parsed?.data) ? parsed.data : [];
    // Voyage returns data sorted by index; trust that, then re-sort
    // defensively in case the API ever changes.
    return data
      .slice()
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((d) => d.embedding);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Embed a list of texts and return parallel vectors.
 *
 * @param {string[]} texts
 * @param {object}   [opts]
 * @param {string}   [opts.inputType]  'document' | 'query' (default: undefined)
 * @param {string}   [opts.model]      override VOYAGE_MODEL / default
 * @param {number}   [opts.timeoutMs]  per-batch timeout (default 60s)
 * @returns {Promise<number[][]>}
 */
export async function embed(texts, opts = {}) {
  if (!Array.isArray(texts)) throw new Error('embed: texts must be an array');
  if (texts.length === 0) return [];
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error('VOYAGE_API_KEY is not set');
  const model = opts.model || process.env.VOYAGE_MODEL || DEFAULT_MODEL;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;

  const batches = chunkArray(texts, VOYAGE_BATCH_MAX);
  const out = [];
  for (const batch of batches) {
    const vecs = await callVoyage(batch, { model, inputType: opts.inputType, apiKey, timeoutMs });
    if (vecs.length !== batch.length) {
      throw new Error(`Voyage returned ${vecs.length} vectors for ${batch.length} inputs`);
    }
    out.push(...vecs);
  }
  return out;
}
