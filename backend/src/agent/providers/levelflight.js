// LevelFlight client.
// Read-only. Auth is OAuth2 refresh-token grant, mirroring scripts/exjet-api-probe.js.
// Token is cached in memory; we decode its JWT `exp` claim and refresh ~5 minutes early.

import 'dotenv/config';

const RAW_BASE = process.env.LEVELFLIGHT_BASE_URL || 'https://rest.levelflight.com';
const TOKEN_URL = process.env.LEVELFLIGHT_TOKEN_URL || '';
const CLIENT_ID = process.env.LEVELFLIGHT_CLIENT_ID || '';
const REFRESH_TOKEN = process.env.LEVELFLIGHT_REFRESH_TOKEN || '';
const TIMEOUT_MS = parseInt(process.env.LEVELFLIGHT_TIMEOUT_MS || '30000', 10);
const REFRESH_SKEW_MS = 5 * 60 * 1000; // refresh 5 minutes before exp

// If the configured base already has a path segment (stage baked in), use as-is.
// Otherwise append /prod, as the brief specifies.
function buildBase(root) {
  const trimmed = root.replace(/\/+$/, '');
  const afterHost = trimmed.replace(/^https?:\/\/[^/]+/, '');
  return afterHost ? trimmed : `${trimmed}/prod`;
}
const BASE = buildBase(RAW_BASE);

let tokenCache = null; // { token: string, expiresAt: number }

function decodeJwtExp(jwt) {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    );
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function fetchToken() {
  if (!TOKEN_URL || !CLIENT_ID || !REFRESH_TOKEN) {
    throw new Error('LevelFlight OAuth env not configured (LEVELFLIGHT_TOKEN_URL / LEVELFLIGHT_CLIENT_ID / LEVELFLIGHT_REFRESH_TOKEN)');
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: REFRESH_TOKEN,
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let j;
    try { j = JSON.parse(text); } catch { j = null; }
    if (!res.ok || !j || !j.id_token) {
      throw new Error(`LevelFlight token exchange failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    const token = j.id_token;
    // Prefer JWT exp; fall back to expires_in if exp is unreadable.
    const expFromJwt = decodeJwtExp(token);
    const expFromIn = j.expires_in ? Date.now() + j.expires_in * 1000 : null;
    const expiresAt = expFromJwt || expFromIn || (Date.now() + 50 * 60 * 1000);
    return { token, expiresAt };
  } finally {
    clearTimeout(timer);
  }
}

async function getToken() {
  if (tokenCache && tokenCache.expiresAt - REFRESH_SKEW_MS > Date.now()) {
    return tokenCache.token;
  }
  tokenCache = await fetchToken();
  return tokenCache.token;
}

async function lfRequest(method, path, body) {
  const token = await getToken();
  const url = BASE + path;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    if (!res.ok) {
      const msg = (parsed && (parsed.message || parsed.error)) || `HTTP ${res.status}`;
      const err = new Error(`LevelFlight ${path}: ${msg}`);
      err.status = res.status;
      err.body = parsed;
      throw err;
    }
    // LevelFlight wraps everything in { success, message, ... }. If success is
    // explicitly false, surface it as an error so the dispatcher can soft-fail.
    if (parsed && typeof parsed === 'object' && parsed.success === false) {
      const err = new Error(`LevelFlight ${path}: ${parsed.message || 'request returned success=false'}`);
      err.status = res.status;
      err.body = parsed;
      throw err;
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

export const lfEndpoint = (path) => `LevelFlight ${path}`;
export const lfGet = (path) => lfRequest('GET', path);
export const lfPost = (path, body = {}) => lfRequest('POST', path, body);

export async function listAircraft() {
  return lfGet('/api/aircraft/list');
}

export async function getAircraftById(id) {
  return lfGet(`/api/aircraft/${encodeURIComponent(id)}`);
}

export async function listPilots() {
  return lfGet('/api/pilots/list');
}

export async function workOrdersRanged(startMs, endMs) {
  return lfPost('/api/workOrder/ranged', { start: startMs, end: endMs });
}

export async function analyticsTickets(startMs, endMs) {
  return lfPost('/api/analytics/tickets', { start: startMs, end: endMs });
}

export async function analyticsDutyTimes(startMs, endMs) {
  return lfPost('/api/analytics/dutyTimes', { start: startMs, end: endMs });
}

// Future-scheduled legs. analytics/dutyTimes only returns past completed
// legs; this endpoint returns the assignment-side view (everything LF has
// scheduled), keyed by a single `start` timestamp. The dashboard pattern
// (src/services/levelflight.js + src/routes/levelflight.js) calls it once
// per month and concatenates — match that here.
export async function analyticsScheduledLegs(startMs) {
  return lfPost('/api/analytics/scheduledLegs', { start: startMs });
}

export async function widgetsOnDuty(body = {}) {
  return lfPost('/api/widgets/onDuty', body);
}
