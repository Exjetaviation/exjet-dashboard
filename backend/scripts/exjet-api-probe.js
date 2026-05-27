#!/usr/bin/env node
/**
 * ────────────────────────────────────────────────────────────────
 *  Exjet Operations Copilot — API Probe
 * ────────────────────────────────────────────────────────────────
 *  Tests what the ForeFlight Dispatch API and the LevelFlight API
 *  actually return, so we know exactly what data the dispatcher
 *  agent can rely on.
 *
 *  USAGE
 *    node exjet-api-probe.js                       (reads ./.env)
 *    node exjet-api-probe.js --env /path/to/.env   (your existing .env)
 *
 *  AUTH (auto-detected from your .env)
 *    ForeFlight  : FOREFLIGHT_API_KEY  → sent as the "x-api-key" header.
 *    LevelFlight : either a direct token (LEVELFLIGHT_ID_TOKEN / LF_TOKEN),
 *                  or an OAuth2 refresh-token exchange using
 *                  LEVELFLIGHT_REFRESH_TOKEN + LEVELFLIGHT_CLIENT_ID
 *                  + LEVELFLIGHT_TOKEN_URL  (client secret optional).
 *
 *  Output: console summary + a "probe-report.md" file in the current
 *  directory. Paste that report back into the chat.
 *
 *  Requires Node 18+ (uses built-in fetch). No npm install needed.
 *  Read-only: every call is a GET, or a POST to a list/search/
 *  analytics endpoint. Nothing is created, edited, or deleted.
 * ────────────────────────────────────────────────────────────────
 */
'use strict';

const fs = require('fs');
const path = require('path');

/* ─────────────── CLI args ─────────────── */
let envPath = path.join(__dirname, '.env');
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--env' && argv[i + 1]) { envPath = argv[i + 1]; i++; }
  else if (argv[i].startsWith('--env=')) envPath = argv[i].slice(6);
}

/* ─────────────── .env loader (no dependency) ─────────────── */
function loadEnv(file) {
  if (!fs.existsSync(file)) return false;
  for (let line of fs.readFileSync(file, 'utf8').split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
  return true;
}
const envLoaded = loadEnv(envPath);

/* ─────────────── config (with name aliases) ─────────────── */
function pick(...names) {
  for (const n of names) {
    if (process.env[n] !== undefined && process.env[n] !== '') return process.env[n];
  }
  return '';
}
const CFG = {
  ffBase: pick('FF_BASE_URL', 'FOREFLIGHT_BASE_URL', 'FOREFLIGHT_API_BASE')
    || 'https://dispatch.foreflight.com',
  ffKey: pick('FF_API_KEY', 'FOREFLIGHT_API_KEY', 'FOREFLIGHT_KEY',
    'FOREFLIGHT_DISPATCH_API_KEY', 'FOREFLIGHT_DISPATCH_KEY'),
  // ForeFlight Dispatch expects the key in the "x-api-key" header (no prefix).
  ffAuthHeader: pick('FF_AUTH_HEADER') || 'x-api-key',
  ffAuthPrefix: process.env.FF_AUTH_PREFIX !== undefined ? process.env.FF_AUTH_PREFIX : '',

  lfStage: pick('LF_STAGE', 'LEVELFLIGHT_STAGE') || 'prod',
  lfRoot: pick('LF_BASE_URL', 'LEVELFLIGHT_BASE_URL', 'LEVELFLIGHT_API_BASE')
    || 'https://rest.levelflight.com',
  lfToken: pick('LF_TOKEN', 'LEVELFLIGHT_TOKEN', 'LEVELFLIGHT_ACCESS_TOKEN',
    'LEVELFLIGHT_ID_TOKEN', 'LEVELFLIGHT_JWT'),
  lfRefreshToken: pick('LF_REFRESH_TOKEN', 'LEVELFLIGHT_REFRESH_TOKEN'),
  lfClientId: pick('LF_CLIENT_ID', 'LEVELFLIGHT_CLIENT_ID'),
  lfClientSecret: pick('LF_CLIENT_SECRET', 'LEVELFLIGHT_CLIENT_SECRET'),
  lfTokenUrl: pick('LF_TOKEN_URL', 'LEVELFLIGHT_TOKEN_URL'),
  lfScope: pick('LF_SCOPE', 'LEVELFLIGHT_SCOPE'),

  timeout: parseInt(pick('PROBE_TIMEOUT_MS') || '20000', 10),
};

// Build the LevelFlight base. If the configured base already has a path
// segment (i.e. the stage is baked in), use it as-is; otherwise append stage.
function buildLfBase() {
  const root = CFG.lfRoot.replace(/\/+$/, '');
  const afterHost = root.replace(/^https?:\/\/[^/]+/, '');
  return afterHost ? root : `${root}/${CFG.lfStage}`;
}
const LF_BASE = buildLfBase();
const results = [];

// which LevelFlight auth path is available
function lfAuthMode() {
  if (CFG.lfToken) return 'direct';
  if (CFG.lfRefreshToken && CFG.lfClientId && CFG.lfTokenUrl) return 'refresh';
  if (CFG.lfClientId && CFG.lfClientSecret && CFG.lfTokenUrl) return 'client_credentials';
  return 'none';
}

/* ─────────────── helpers ─────────────── */
function ffHeaders() {
  const h = { Accept: 'application/json' };
  if (CFG.ffKey) h[CFG.ffAuthHeader] = CFG.ffAuthPrefix + CFG.ffKey;
  return h;
}
function lfHeaders(auth = true) {
  const h = { Accept: 'application/json' };
  if (auth && CFG.lfToken) h.Authorization = 'Bearer ' + CFG.lfToken;
  return h;
}

function describeShape(v, depth = 0) {
  if (v === null) return 'null';
  if (Array.isArray(v)) {
    if (v.length === 0) return 'array (empty)';
    return `array[${v.length}] of ${describeShape(v[0], depth + 1)}`;
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    const max = depth > 0 ? 10 : 24;
    const shown = keys.slice(0, max).join(', ');
    return `object{ ${shown}${keys.length > max ? ', …' : ''} }`;
  }
  return typeof v;
}

// pull the first record out of a list-style response, tolerating wrappers
function firstFrom(data) {
  if (Array.isArray(data)) return data.length ? data[0] : null;
  if (data && typeof data === 'object') {
    const known = [
      'data', 'results', 'result', 'flights', 'items', 'rows', 'records',
      'dispatches', 'dispatch', 'workOrders', 'workorders', 'aircraft',
      'aircrafts', 'legs', 'list', 'pilots', 'users', 'crew',
    ];
    for (const k of known) {
      if (Array.isArray(data[k]) && data[k].length) return data[k][0];
    }
    for (const v of Object.values(data)) {
      if (Array.isArray(v) && v.length) return v[0];
      if (v && typeof v === 'object') {
        for (const k of known) {
          if (Array.isArray(v[k]) && v[k].length) return v[k][0];
        }
      }
    }
  }
  return null;
}

// find an id on a record, handling EJSON { "$oid": "..." } shapes
function findId(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of ['_id', 'id', 'guid', 'objectId', 'flightId', 'uuid', 'legId']) {
    const v = obj[k];
    if (v == null) continue;
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    if (typeof v === 'object' && v.$oid) return String(v.$oid);
  }
  return null;
}

function trimSample(data) {
  let s;
  try {
    s = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  } catch {
    s = String(data);
  }
  if (s.length > 2200) s = s.slice(0, 2200) + '\n… (truncated)';
  return s;
}

/* ─────────────── LevelFlight OAuth2 token exchange ─────────────── */
async function fetchLfToken() {
  const mode = lfAuthMode();
  if (mode === 'direct') return CFG.lfToken;
  if (mode === 'none') return '';

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const body = new URLSearchParams();

  if (mode === 'refresh') {
    body.set('grant_type', 'refresh_token');
    body.set('client_id', CFG.lfClientId);
    body.set('refresh_token', CFG.lfRefreshToken);
    // a confidential client (one with a secret) also needs Basic auth
    if (CFG.lfClientSecret) {
      headers.Authorization = 'Basic ' +
        Buffer.from(`${CFG.lfClientId}:${CFG.lfClientSecret}`).toString('base64');
    }
  } else { // client_credentials
    body.set('grant_type', 'client_credentials');
    headers.Authorization = 'Basic ' +
      Buffer.from(`${CFG.lfClientId}:${CFG.lfClientSecret}`).toString('base64');
    if (CFG.lfScope) body.set('scope', CFG.lfScope);
  }

  try {
    const res = await fetch(CFG.lfTokenUrl, { method: 'POST', headers, body: body.toString() });
    const txt = await res.text();
    let j = null;
    try { j = JSON.parse(txt); } catch { /* not json */ }
    if (res.ok && j && (j.id_token || j.access_token)) {
      const tok = j.id_token || j.access_token;
      const kind = j.id_token ? 'id_token' : 'access_token';
      console.log(`  ✓ LevelFlight token obtained via ${mode} grant (${kind}, ${tok.length} chars)`);
      return tok;
    }
    console.log(`  ✗ LevelFlight ${mode} grant failed (HTTP ${res.status}): ${txt.slice(0, 260)}`);
    return '';
  } catch (e) {
    console.log(`  ✗ LevelFlight token exchange error: ${e.message}`);
    return '';
  }
}

/* ─────────────── the request runner ─────────────── */
async function call(rec) {
  const url = rec.base + rec.path;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CFG.timeout);
  const t0 = Date.now();
  const out = {
    provider: rec.provider, method: rec.method, path: rec.path,
    label: rec.label || '', sample: !!rec.sample, body: rec.body,
    status: null, ms: 0, ok: false, shape: '', note: '', data: null,
  };
  try {
    const headers = { ...rec.headers };
    if (rec.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {
      method: rec.method,
      headers,
      body: rec.body !== undefined ? JSON.stringify(rec.body) : undefined,
      signal: ctrl.signal,
    });
    out.status = res.status;
    out.ok = res.ok;
    out.ms = Date.now() - t0;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const text = await res.text();
    const looksJson = text.trim().startsWith('{') || text.trim().startsWith('[');
    if (ct.includes('json') || looksJson) {
      try {
        const j = JSON.parse(text);
        out.data = j;
        out.shape = describeShape(j);
        if (!res.ok) {
          out.note = String((j && (j.message || j.error || j.errorMessage)) || '').slice(0, 200);
        }
      } catch {
        out.shape = `non-JSON text (${text.length} chars)`;
        out.data = text.slice(0, 400);
      }
    } else if (ct.includes('pdf')) {
      out.shape = `PDF document (${text.length} bytes)`;
    } else if (ct.includes('html')) {
      out.shape = `HTML page (${text.length} chars)`;
    } else {
      out.shape = `${ct || 'unknown content-type'} (${text.length} chars)`;
      out.data = text.slice(0, 400);
    }
  } catch (e) {
    out.ms = Date.now() - t0;
    out.note = e.name === 'AbortError' ? `timeout after ${CFG.timeout}ms` : e.message;
  } finally {
    clearTimeout(timer);
  }
  return out;
}

async function run(provider, method, p, opts = {}) {
  const base = provider === 'FF' ? CFG.ffBase : LF_BASE;
  const headers = provider === 'FF' ? ffHeaders() : lfHeaders(opts.auth !== false);
  const rec = await call({
    provider, method, path: p, base, headers,
    body: opts.body, sample: opts.sample, label: opts.label,
  });
  results.push(rec);
  logLine(rec);
  return rec;
}

/* ─────────────── console output ─────────────── */
function logLine(r) {
  const icon = r.ok ? '✓' : '✗';
  const status = r.status === null ? 'ERR' : String(r.status);
  const pathCol = (r.method + ' ' + r.path).padEnd(52).slice(0, 52);
  const time = (r.ms + 'ms').padStart(7);
  const tail = r.note ? `  ${r.note}` : `  ${r.shape}`;
  console.log(`  ${icon} [${r.provider}] ${pathCol} ${status.padStart(3)} ${time}${tail}`);
}
function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 56 - t.length))}`); }
function banner() {
  console.log('\n========================================================');
  console.log('  Exjet Operations Copilot — API Probe');
  console.log('========================================================');
  console.log(`  Config source : ${envPath} ${envLoaded ? '(loaded)' : '(NOT FOUND — using shell env / defaults)'}`);
  console.log(`  ForeFlight    : ${CFG.ffBase}`);
  console.log(`                  key ${CFG.ffKey ? 'found (' + CFG.ffKey.length + ' chars)' : 'MISSING'}, header "${CFG.ffAuthHeader}"`);
  const modeText = {
    direct: `direct token (${CFG.lfToken.length} chars)`,
    refresh: 'OAuth2 refresh-token grant',
    client_credentials: 'OAuth2 client-credentials grant',
    none: 'MISSING',
  }[lfAuthMode()];
  console.log(`  LevelFlight   : ${LF_BASE}`);
  console.log(`                  auth ${modeText}`);
}

/* ─────────────── main ─────────────── */
async function main() {
  banner();

  /* ===== ForeFlight Dispatch ===== */
  if (!CFG.ffKey) {
    console.log('\n  ⚠  No ForeFlight key resolved — skipping all ForeFlight probes.');
  } else {
    section('ForeFlight Dispatch — discovery');
    await run('FF', 'GET', '/public/api/apiKeyInfo', { sample: true, label: 'auth check + key scopes' });
    await run('FF', 'GET', '/public/api/apiKeyInfo/WebHook', { sample: true, label: 'webhook payload sample' });
    await run('FF', 'GET', '/public/api/aircraft', { sample: true });
    await run('FF', 'GET', '/public/api/crew', { sample: true });
    await run('FF', 'GET', '/public/api/contacts');
    await run('FF', 'GET', '/public/api/airport/Airports');
    await run('FF', 'GET', '/public/api/savedroutes');
    const ffFlights = await run('FF', 'GET', '/public/api/Flights/flights', { sample: true });
    await run('FF', 'GET', '/public/api/Flights/modified', { label: 'change-detection feed' });

    const ffFlightId = process.env.FF_FLIGHT_ID || findId(firstFrom(ffFlights.data));
    section('ForeFlight Dispatch — per-flight reports');
    if (ffFlightId) {
      console.log(`  → using flightId: ${ffFlightId}`);
      const fid = encodeURIComponent(ffFlightId);
      await run('FF', 'GET', `/public/api/Flights/${fid}`, { sample: true });
      await run('FF', 'GET', `/public/api/Flights/${fid}/briefing`, { sample: true, label: 'weather briefing' });
      await run('FF', 'GET', `/public/api/Flights/${fid}/rwa`, { sample: true, label: 'runway analysis' });
      await run('FF', 'GET', `/public/api/Flights/${fid}/performance`, { sample: true, label: 'performance' });
      await run('FF', 'GET', `/public/api/Flights/${fid}/wb`, { label: 'weight & balance' });
      await run('FF', 'GET', `/public/api/Flights/${fid}/navlog`, { label: 'navlog' });
    } else {
      console.log('  ⚠  No flightId could be harvested from /Flights/flights.');
      console.log('     Per-flight probes skipped. Set FF_FLIGHT_ID in your .env to test them.');
    }
  }

  /* ===== LevelFlight ===== */
  if (!CFG.lfToken && lfAuthMode() !== 'none') {
    section('LevelFlight — obtaining OAuth2 token');
    CFG.lfToken = await fetchLfToken();
  }
  if (!CFG.lfToken) {
    console.log('\n  ⚠  No usable LevelFlight token — skipping all LevelFlight probes.');
  } else {
    section('LevelFlight — connectivity & auth');
    await run('LF', 'GET', '/health', { auth: false, label: 'reachability (no auth)' });
    await run('LF', 'GET', '/api/user/authorize', { sample: true, label: 'token / session check' });
    await run('LF', 'GET', '/api/operation/basic', { sample: true, label: 'operation profile' });
    await run('LF', 'GET', '/api/operation/tools', { sample: true, label: 'enabled integrations' });

    section('LevelFlight — directory');
    await run('LF', 'GET', '/api/pilots/list', { sample: true });
    await run('LF', 'GET', '/api/attendants/list');
    await run('LF', 'GET', '/api/mechanics/list');
    await run('LF', 'GET', '/api/safetyTeam/list', { label: 'safety team users' });
    await run('LF', 'GET', '/api/users/list');

    section('LevelFlight — fleet');
    const lfAircraft = await run('LF', 'GET', '/api/aircraft/list', { sample: true });

    section('LevelFlight — schedule & ops');
    const lfDispatch = await run('LF', 'POST', '/api/dispatch/list', { body: {}, sample: true });
    await run('LF', 'POST', '/api/widgets/departingSoon', { body: {} });
    await run('LF', 'POST', '/api/widgets/onDuty', { body: {}, sample: true, label: 'crew on duty' });
    await run('LF', 'POST', '/api/widgets/pendingFlights', { body: {} });

    // wide epoch-millisecond window for range/analytics endpoints
    const DAY = 86400000;
    const range = { start: Date.now() - 90 * DAY, end: Date.now() + 90 * DAY };

    section('LevelFlight — maintenance / work orders');
    const lfWO = await run('LF', 'POST', '/api/workOrder/all', { body: {}, sample: true });
    await run('LF', 'POST', '/api/workOrder/ranged', { body: range, label: '±90-day window (epoch ms)' });

    section('LevelFlight — analytics');
    await run('LF', 'POST', '/api/analytics/dutyTimes', { body: range, sample: true, label: 'duty times' });
    await run('LF', 'POST', '/api/analytics/tickets', { body: range, sample: true, label: 'maintenance tickets' });
    await run('LF', 'POST', '/api/analytics/scheduledLegs', { body: range, label: 'scheduled legs' });

    section('LevelFlight — detail records');
    const lfDispatchId = process.env.LF_DISPATCH_ID || findId(firstFrom(lfDispatch.data));
    const lfAircraftId = process.env.LF_AIRCRAFT_ID || findId(firstFrom(lfAircraft.data));
    const lfWOId = process.env.LF_WORKORDER_ID || findId(firstFrom(lfWO.data));
    let lfLegId = process.env.LF_LEG_ID || null;

    if (lfAircraftId) {
      console.log(`  → aircraft id: ${lfAircraftId}`);
      await run('LF', 'GET', `/api/aircraft/${encodeURIComponent(lfAircraftId)}`, { sample: true });
    } else console.log('  ⚠  no aircraft id harvested');

    if (lfWOId) {
      console.log(`  → work order id: ${lfWOId}`);
      await run('LF', 'GET', `/api/workOrder/${encodeURIComponent(lfWOId)}`, { sample: true });
    } else console.log('  ⚠  no work order id harvested');

    if (lfDispatchId) {
      console.log(`  → dispatch id: ${lfDispatchId}`);
      const itin = await run('LF', 'GET',
        `/api/dispatch/${encodeURIComponent(lfDispatchId)}/itinerary`, { sample: true });
      if (!lfLegId) lfLegId = findId(firstFrom(itin.data));
    } else console.log('  ⚠  no dispatch id harvested');

    if (lfLegId) {
      console.log(`  → leg id: ${lfLegId}`);
      await run('LF', 'GET', `/api/leg/${encodeURIComponent(lfLegId)}`, { sample: true });
    } else console.log('  ⚠  no leg id harvested');
  }

  writeReport();
}

/* ─────────────── report ─────────────── */
function writeReport() {
  const ok = results.filter((r) => r.ok).length;
  const c4 = results.filter((r) => r.status >= 400 && r.status < 500).length;
  const c5 = results.filter((r) => r.status >= 500).length;
  const err = results.filter((r) => r.status === null).length;

  console.log('\n========================================================');
  console.log(`  Done. ${ok}/${results.length} returned 2xx` +
    `  |  ${c4} client errors  |  ${c5} server errors  |  ${err} no response`);
  console.log('========================================================');

  const L = [];
  L.push('# Exjet API Probe — Report');
  L.push('');
  L.push(`Generated: ${new Date().toISOString()}`);
  L.push(`ForeFlight base: \`${CFG.ffBase}\``);
  L.push(`LevelFlight base: \`${LF_BASE}\``);
  L.push('');
  L.push(`**Summary:** ${ok}/${results.length} OK · ${c4} client errors (4xx) · ` +
    `${c5} server errors (5xx) · ${err} no response`);
  L.push('');

  for (const prov of ['FF', 'LF']) {
    const rows = results.filter((r) => r.provider === prov);
    if (!rows.length) continue;
    L.push(`## ${prov === 'FF' ? 'ForeFlight Dispatch' : 'LevelFlight'}`);
    L.push('');
    L.push('| Method | Path | Status | Time | Result |');
    L.push('|---|---|---|---|---|');
    for (const r of rows) {
      const result = r.note ? `⚠ ${r.note}` : r.shape;
      L.push(`| ${r.method} | \`${r.path}\` | ${r.status ?? 'ERR'} | ${r.ms}ms | ${result.replace(/\|/g, '\\|')} |`);
    }
    L.push('');
  }

  const samples = results.filter((r) => r.sample && r.data != null);
  if (samples.length) {
    L.push('## Response samples');
    L.push('');
    for (const r of samples) {
      L.push(`### [${r.provider}] ${r.method} \`${r.path}\`` + (r.label ? ` — ${r.label}` : ''));
      if (r.body !== undefined) L.push(`Request body: \`${JSON.stringify(r.body)}\``);
      L.push('');
      L.push('```json');
      L.push(trimSample(r.data));
      L.push('```');
      L.push('');
    }
  }

  const reportPath = path.join(process.cwd(), 'probe-report.md');
  fs.writeFileSync(reportPath, L.join('\n'), 'utf8');
  console.log(`\n  Report written to: ${reportPath}`);
  console.log('  Paste that file back into the chat.\n');
}

main().catch((e) => {
  console.error('\nFATAL:', e);
  process.exit(1);
});
