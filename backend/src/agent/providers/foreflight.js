// ForeFlight Dispatch client.
// Read-only. Every call is a GET. Auth is the x-api-key header,
// mirroring the proven approach in scripts/exjet-api-probe.js.

import 'dotenv/config';

// pdf-parse is lazy-loaded inside fetchDocumentText below. Its transitive
// dep (pdfjs-dist) evaluates browser APIs at module load (DOMMatrix,
// ImageData, Path2D) and needs Node 20.12+ to polyfill them via
// process.getBuiltinModule. Eager-importing here would crash the entire
// backend at boot on any older runtime — deferring the import keeps the
// rest of the agent alive even if PDF extraction fails.

const BASE = process.env.FOREFLIGHT_BASE_URL || 'https://dispatch.foreflight.com';
const API_KEY = process.env.FOREFLIGHT_API_KEY || '';
const TIMEOUT_MS = parseInt(process.env.FOREFLIGHT_TIMEOUT_MS || '30000', 10);

// Cap how much PDF text we hand the agent. ForeFlight briefings can run to
// 100KB+ — beyond ~30k chars the marginal value of more text drops fast
// while token cost and latency keep climbing.
const PDF_MAX_CHARS = 30000;
const PDF_FETCH_TIMEOUT_MS = parseInt(process.env.FOREFLIGHT_PDF_TIMEOUT_MS || '30000', 10);

async function ffGet(path) {
  if (!API_KEY) {
    throw new Error('FOREFLIGHT_API_KEY is not set');
  }
  const url = BASE.replace(/\/+$/, '') + path;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': API_KEY, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) {
      const msg = (body && (body.message || body.error)) || `HTTP ${res.status}`;
      const err = new Error(`ForeFlight ${path}: ${msg}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export const ffEndpoint = (path) => `ForeFlight ${path}`;

export async function listFlights() {
  return ffGet('/public/api/Flights/flights');
}

export async function getFlight(flightId) {
  return ffGet(`/public/api/Flights/${encodeURIComponent(flightId)}`);
}

export async function getPerformance(flightId) {
  return ffGet(`/public/api/Flights/${encodeURIComponent(flightId)}/performance`);
}

// Strip HTML to readable text. Aviation reports are mostly tables and
// labels — no nested-div content trees — so a regex-based stripper is
// sufficient and keeps us from pulling in cheerio just for two pages.
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Fetch a signed ForeFlight document URL and extract its text. ForeFlight
// serves weather briefings as PDFs and runway analyses as HTML, so this
// branches on what actually came back rather than what we expected.
// Fail-soft: any error (network, HTTP, parse) returns
// { text: null, textLength: 0, error } so the caller can still hand the
// agent the URL.
async function fetchDocumentText(url) {
  if (!url || typeof url !== 'string') {
    return { text: null, textLength: 0, error: 'no document URL returned' };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PDF_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      return { text: null, textLength: 0, error: `document HTTP ${res.status}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const isPdf = ct.includes('pdf') || buf.slice(0, 5).toString('latin1') === '%PDF-';
    const isHtml = ct.includes('html') || buf.slice(0, 14).toString('latin1').toLowerCase().startsWith('<!doctype html');

    let raw = '';
    if (isPdf) {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: buf });
      const result = await parser.getText();
      raw = typeof result?.text === 'string' ? result.text : '';
    } else if (isHtml) {
      raw = htmlToText(buf.toString('utf8'));
    } else {
      return { text: null, textLength: 0, error: `unsupported document content-type: ${ct || 'unknown'}` };
    }

    const trimmed = raw.length > PDF_MAX_CHARS
      ? raw.slice(0, PDF_MAX_CHARS) + '\n\n… (truncated)'
      : raw;
    return { text: trimmed, textLength: raw.length };
  } catch (e) {
    return { text: null, textLength: 0, error: e?.message || String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export async function getRunwayAnalysis(flightId) {
  const meta = await ffGet(`/public/api/Flights/${encodeURIComponent(flightId)}/rwa`);
  const doc = await fetchDocumentText(meta?.url);
  return { url: meta?.url ?? null, timeGenerated: meta?.timeGenerated ?? null, ...doc };
}

export async function getWeatherBriefing(flightId) {
  const meta = await ffGet(`/public/api/Flights/${encodeURIComponent(flightId)}/briefing`);
  const doc = await fetchDocumentText(meta?.url);
  return { url: meta?.url ?? null, timeGenerated: meta?.timeGenerated ?? null, ...doc };
}
