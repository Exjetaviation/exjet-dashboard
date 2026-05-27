// Tool dispatcher for the Operations Copilot agent.
// executeTool(name, input) → structured JSON + `source`, or { error } on any failure.
// Never throws.

import {
  listFlights,
  getFlight,
  getPerformance,
  getRunwayAnalysis,
  getWeatherBriefing,
} from '../providers/foreflight.js';
import {
  listAircraft,
  getAircraftById,
  listPilots,
  workOrdersRanged,
  analyticsTickets,
  analyticsDutyTimes,
  analyticsScheduledLegs,
  widgetsOnDuty,
} from '../providers/levelflight.js';
import { toolNames, RENDER_REVIEW_TOOL } from './schemas.js';
import { createClient } from '@supabase/supabase-js';
import { embed } from '../embeddings.js';

// Lazily-built Supabase client for vector search. Same service-key pattern
// as reviewStore.js — read-only here (calls the match_manual_chunks RPC).
let _supabase = null;
function getSupabaseForSearch() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY must be set for search_manuals');
  _supabase = createClient(url, key);
  return _supabase;
}

/* ─────────────── helpers ─────────────── */

const DAY_MS = 86400000;
const HOUR_MS = 3600000;

// Time the pilot stays "on duty" after the wheels-stop arrival before the
// duty period closes (pax handoff, post-flight paperwork). The duty period
// is therefore [planned departure, planned arrival + this].
const POST_FLIGHT_BUFFER_MS = 30 * 60 * 1000;

// Defaults blend FAR §135.267(d) (the calendar quarter / annual numbers)
// with operationally common per-duty-period limits. The GOM and the
// Chief Pilot are the operational authority — these are starting values
// the agent should treat as such, not as regulatory citations.
const DUTY_REST_THRESHOLDS = {
  duty_time_max_hours:    14,
  rest_required_hours:    10,
  flight_time_24h:        10,
  flight_time_7d:         32,
  flight_time_30d:        100,
  flight_time_quarter:    500,
  flight_time_annual:     1400,
  advisory_threshold_pct: 80,
};

function parseDateUtc(s, endOfDay = false) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`invalid date "${s}", expected YYYY-MM-DD`);
  }
  const t = Date.parse(s + (endOfDay ? 'T23:59:59.999Z' : 'T00:00:00Z'));
  if (Number.isNaN(t)) throw new Error(`invalid date "${s}"`);
  return t;
}

// Extract a string id from a LevelFlight value that may be a raw string,
// or an EJSON-style { $oid: "..." } object.
function oid(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && typeof v.$oid === 'string') return v.$oid;
  return null;
}

const OID_RE = /^[a-f0-9]{24}$/i;
const isObjectId = (s) => typeof s === 'string' && OID_RE.test(s);

// Derive lifecycle status for an SMS/safety ticket from its `logs` object.
function ticketLifecycle(logs) {
  if (!logs || typeof logs !== 'object') return { stage: null, stages: [], status: 'unknown' };
  const order = ['opened', 'processed', 'analyzed', 'corrected', 'followedUp', 'closed'];
  const stages = order.filter((k) => logs[k]);
  const stage = stages.length ? stages[stages.length - 1] : null;
  const status = logs.closed ? 'closed' : stage ? 'open' : 'unknown';
  return { stage, stages, status };
}

function normalizeTicket(t) {
  if (!t || typeof t !== 'object') return null;
  const lifecycle = ticketLifecycle(t.logs);
  return {
    id: oid(t._id) || t.id_str || (t.id != null ? String(t.id) : null),
    description: t.description ?? null,
    ataCode: t.ataCode ?? null,
    discrepancy: t.discrepancy === true,
    asapEvent: t.asapEvent === true,
    anonymous: t.anonymous === true,
    tailNumber: t.aircraft?.tailNumber ?? null,
    eventDate: t.eventDate ?? null,
    createdOn: t.createdOn ?? null,
    lifecycle,
  };
}

function normalizeWorkOrder(w) {
  if (!w || typeof w !== 'object') return null;
  return {
    id: oid(w._id) || null,
    name: w.name ?? null,
    tailNumber: w.aircraft?.tailNumber ?? null,
    airport: w.airport ?? null,
    start: w.start ?? null,
    end: w.end ?? null,
    proposedEnd: w.proposedEnd ?? null,
    completed: w.completed === true,
    findings: w.findings ?? null,
    smsEventIds: Array.isArray(w.smsEvents) ? w.smsEvents.map(oid).filter(Boolean) : [],
    status: w.completed === true ? 'closed' : 'open',
  };
}

// Pull tickets out of analyticsTickets response — they live under `totals`
// (keyed by status bucket) and/or a flat `tickets` array. Merge + dedupe by id.
function collectTickets(resp) {
  const out = new Map();
  const push = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const t of arr) {
      const n = normalizeTicket(t);
      if (n && n.id && !out.has(n.id)) out.set(n.id, n);
    }
  };
  if (resp?.tickets) push(resp.tickets);
  if (resp?.totals && typeof resp.totals === 'object') {
    for (const v of Object.values(resp.totals)) push(v);
  }
  return [...out.values()];
}

// /api/analytics/tickets silently returns no `totals` (and 0 tickets) when the
// window is too wide (anything past ~6 months). Walk the range in 90-day
// buckets and aggregate. Returns raw ticket records (not normalized) so the
// caller can decide what to keep.
async function ticketsOverRange(startMs, endMs, bucketMs = 90 * DAY_MS) {
  const buckets = [];
  for (let s = startMs; s < endMs; s += bucketMs) {
    buckets.push([s, Math.min(s + bucketMs, endMs)]);
  }
  // Run buckets in parallel — they're independent reads.
  const responses = await Promise.all(
    buckets.map(([s, e]) => analyticsTickets(s, e).catch(() => null)),
  );
  const seen = new Set();
  const merged = [];
  for (const r of responses) {
    if (!r) continue;
    const collect = (arr) => {
      for (const t of arr || []) {
        const id = t?._id?.$oid;
        if (id && !seen.has(id)) { seen.add(id); merged.push(t); }
      }
    };
    if (Array.isArray(r.tickets)) collect(r.tickets);
    if (r.totals && typeof r.totals === 'object') {
      for (const v of Object.values(r.totals)) collect(v);
    }
  }
  return merged;
}

// True if any string value anywhere in the ticket object matches the ICAO.
// We compare uppercase-trimmed; the structured fields we know about
// (`description`, `airport`, `location`) plus any other top-level string
// fields get scanned.
function ticketMentionsIcao(t, icao) {
  if (!t || typeof t !== 'object') return false;
  const target = icao.toUpperCase();
  const word = new RegExp(`\\b${target}\\b`);
  for (const v of Object.values(t)) {
    if (typeof v === 'string' && word.test(v.toUpperCase())) return true;
  }
  return false;
}

function eqTail(a, b) {
  return typeof a === 'string' && typeof b === 'string' &&
    a.trim().toUpperCase() === b.trim().toUpperCase();
}

// Build month-start (UTC, 1st of month 00:00) timestamps covering the
// window. The scheduledLegs endpoint takes a single `start` and returns
// the assignments anchored at that month — matches the per-month pattern
// in src/routes/levelflight.js.
function monthStartsUtc(startMs, endMs) {
  const out = [];
  const s = new Date(startMs);
  const e = new Date(endMs);
  let y = s.getUTCFullYear();
  let m = s.getUTCMonth();
  while (true) {
    const t = Date.UTC(y, m, 1);
    if (t > endMs) break;
    out.push(t);
    m += 1;
    if (m > 11) { m = 0; y += 1; }
    // Safety guard: don't run forever if endMs is malformed.
    if (out.length > 240) break;
  }
  // Always include the month BEFORE startMs too — the bucket boundary
  // may sit just before a leg we care about.
  const prior = Date.UTC(s.getUTCFullYear(), s.getUTCMonth() - 1, 1);
  if (prior < out[0]) out.unshift(prior);
  void e;
  return out;
}

// analytics/dutyTimes is the same shape of endpoint as analytics/tickets,
// which silently truncates on wide windows — chunk in 90-day buckets and
// merge. dutyTimes returns only completed (past) legs; for future
// assignments we also call analytics/scheduledLegs once per month
// spanning the window. The two leg sets are merged + deduped by _id.
async function dutyTimesOverRange(startMs, endMs, bucketMs = 90 * DAY_MS) {
  const dutyBuckets = [];
  for (let s = startMs; s < endMs; s += bucketMs) {
    dutyBuckets.push([s, Math.min(s + bucketMs, endMs)]);
  }
  const months = monthStartsUtc(startMs, endMs);

  // Run both fetch sets in parallel.
  const [dutyResponses, schedResponses] = await Promise.all([
    Promise.all(dutyBuckets.map(([s, e]) => analyticsDutyTimes(s, e).catch(() => null))),
    Promise.all(months.map((ts) => analyticsScheduledLegs(ts).catch(() => null))),
  ]);

  const dutyTimes = [];
  const legs = [];
  const seenDuty = new Set();
  const seenLeg = new Set();

  const addLegs = (arr) => {
    for (const leg of arr || []) {
      const id = oid(leg?._id);
      const k = id || `${leg?.departure?.time}|${leg?.arrival?.time}|${leg?.dispatch?.aircraft?.tailNumber}`;
      if (seenLeg.has(k)) continue;
      seenLeg.add(k);
      legs.push(leg);
    }
  };

  for (const r of dutyResponses) {
    if (!r) continue;
    for (const dw of r.dutyTimes || []) {
      const k = `${oid(dw.user)}|${dw.out}|${dw.in}`;
      if (seenDuty.has(k)) continue;
      seenDuty.add(k);
      dutyTimes.push(dw);
    }
    addLegs(r.legs);
  }
  for (const r of schedResponses) {
    if (!r) continue;
    addLegs(r.legs);
  }

  return { dutyTimes, legs };
}

// Milliseconds of overlap between two intervals (clamped at 0). Used to
// "count toward each window only the time that falls inside it."
function overlapMs(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

// Build the cumulative-flight-time windows for a given duty period.
//   - 24h / 7d / 30d:  rolling windows ending at duty_end (so the proposed
//                      flight's contribution is fully inside).
//   - quarter / annual: the calendar quarter / year containing the proposed
//                       duty (boundaries from JS Date constructors).
function buildFlightTimeWindows(dutyEnd) {
  const d = new Date(dutyEnd);
  const y = d.getFullYear();
  const qStartMonth = Math.floor(d.getMonth() / 3) * 3;
  const qStart = new Date(y, qStartMonth, 1).getTime();
  const qEnd = new Date(y, qStartMonth + 3, 1).getTime() - 1;
  const yStart = new Date(y, 0, 1).getTime();
  const yEnd = new Date(y + 1, 0, 1).getTime() - 1;
  return {
    flight_time_24h:     { start: dutyEnd - 24 * HOUR_MS,  end: dutyEnd, limit: DUTY_REST_THRESHOLDS.flight_time_24h },
    flight_time_7d:      { start: dutyEnd - 7 * DAY_MS,    end: dutyEnd, limit: DUTY_REST_THRESHOLDS.flight_time_7d },
    flight_time_30d:     { start: dutyEnd - 30 * DAY_MS,   end: dutyEnd, limit: DUTY_REST_THRESHOLDS.flight_time_30d },
    flight_time_quarter: { start: qStart,                  end: qEnd,    limit: DUTY_REST_THRESHOLDS.flight_time_quarter },
    flight_time_annual:  { start: yStart,                  end: yEnd,    limit: DUTY_REST_THRESHOLDS.flight_time_annual },
  };
}

// Threshold check: hours vs limit. Status is 'violation' if over, 'advisory'
// at or above advisory_threshold_pct, else 'compliant'. Pct returned for
// display so the agent can be specific in its evidence.
function classifyVsLimit(hours, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return { status: 'compliant', pct: 0 };
  const pct = Math.round((hours / limit) * 100);
  if (hours > limit) return { status: 'violation', pct };
  if (pct >= DUTY_REST_THRESHOLDS.advisory_threshold_pct) return { status: 'advisory', pct };
  return { status: 'compliant', pct };
}

// Aggregate flight time across one pilot's legs (LevelFlight) plus a
// synthetic "proposed" leg, intersected with each window. Returns the
// per-window block in the spec's shape.
function computeCumulative(pilotLegs, windows, proposedLeg) {
  const allLegs = proposedLeg ? [...pilotLegs, proposedLeg] : pilotLegs;
  const out = {};
  for (const [key, w] of Object.entries(windows)) {
    let ms = 0;
    for (const leg of allLegs) {
      if (typeof leg.start !== 'number' || typeof leg.end !== 'number' || leg.end <= leg.start) continue;
      ms += overlapMs(leg.start, leg.end, w.start, w.end);
    }
    const hours = Math.round((ms / HOUR_MS) * 10) / 10;
    const { status, pct } = classifyVsLimit(hours, w.limit);
    out[key] = { hours, limit: w.limit, status, pct };
  }
  return out;
}

// Find the LevelFlight leg that matches a ForeFlight flight by tail,
// departure ICAO, arrival ICAO, and departure date (UTC YYYY-MM-DD). Used
// to attribute crew assignments to the proposed flight when the agent
// passes a ForeFlight flight_id. Returns null if no unambiguous match.
function findMatchingLfLeg(lfLegs, { tail, departure, destination, departureDate }) {
  const targetDate = String(departureDate || '').slice(0, 10);
  const matches = (lfLegs || []).filter((leg) => {
    if (eqTail(leg?.dispatch?.aircraft?.tailNumber, tail) !== true) return false;
    if ((leg?.departure?.airport || '').toUpperCase() !== String(departure || '').toUpperCase()) return false;
    if ((leg?.arrival?.airport || '').toUpperCase() !== String(destination || '').toUpperCase()) return false;
    const t = leg?.departure?.time;
    if (typeof t !== 'number') return false;
    const day = new Date(t).toISOString().slice(0, 10);
    return day === targetDate;
  });
  // Exactly one is the unambiguous case. If there are multiple legs on the
  // same day with the same tail and route (rare), the caller will surface
  // the ambiguity in its output.
  return matches.length === 1 ? matches[0] : null;
}

async function fetchJson(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      // aviationweather.gov throttles requests with no UA — keep one set.
      headers: { Accept: 'application/json', 'User-Agent': 'exjet-copilot/0.1' },
      signal: ctrl.signal,
    });
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}: ${typeof body === 'string' ? body.slice(0, 200) : (body?.message || '')}`);
      err.status = res.status;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────────── tool implementations ─────────────── */

async function tool_list_flights({ start_date, end_date, tail }) {
  const startMs = parseDateUtc(start_date);
  const endMs = parseDateUtc(end_date, true);
  const resp = await listFlights();
  const all = Array.isArray(resp?.flights) ? resp.flights : [];
  const filtered = all.filter((f) => {
    const t = f.departureTime ? Date.parse(f.departureTime) : null;
    if (t == null || Number.isNaN(t)) return false;
    if (t < startMs || t > endMs) return false;
    if (tail && !eqTail(f.aircraftRegistration, tail)) return false;
    return true;
  });
  const flights = filtered.map((f) => ({
    flightId: f.flightId,
    departure: f.departure,
    destination: f.destination,
    aircraftRegistration: f.aircraftRegistration,
    departureTime: f.departureTime,
    arrivalTime: f.arrivalTime,
    tripTime: f.tripTime,
    route: f.route,
    callSign: f.callSign,
    filingStatus: f.filingStatus,
    atcStatus: f.atcStatus,
    released: f.released === true,
    crew: Array.isArray(f.crew)
      ? f.crew.map((c) => ({ position: c.position, crewId: c.crewId }))
      : [],
  }));
  return {
    count: flights.length,
    flights,
    warnings: resp?.warnings ?? null,
    source: 'ForeFlight GET /public/api/Flights/flights',
  };
}

async function tool_get_flight({ flight_id }) {
  const r = await getFlight(flight_id);
  return { ...r, source: `ForeFlight GET /public/api/Flights/${flight_id}` };
}

async function tool_get_performance({ flight_id }) {
  const r = await getPerformance(flight_id);
  return { ...r, source: `ForeFlight GET /public/api/Flights/${flight_id}/performance` };
}

async function tool_get_runway_analysis({ flight_id }) {
  const r = await getRunwayAnalysis(flight_id);
  return {
    url: r?.url ?? null,
    timeGenerated: r?.timeGenerated ?? null,
    text: r?.text ?? null,
    textLength: r?.textLength ?? 0,
    ...(r?.error ? { error: r.error } : {}),
    source: `ForeFlight GET /public/api/Flights/${flight_id}/rwa`,
  };
}

async function tool_get_weather_briefing({ flight_id }) {
  const r = await getWeatherBriefing(flight_id);
  return {
    url: r?.url ?? null,
    timeGenerated: r?.timeGenerated ?? null,
    text: r?.text ?? null,
    textLength: r?.textLength ?? 0,
    ...(r?.error ? { error: r.error } : {}),
    source: `ForeFlight GET /public/api/Flights/${flight_id}/briefing`,
  };
}

async function tool_get_airport_weather({ icaos }) {
  if (!Array.isArray(icaos) || icaos.length === 0) {
    throw new Error('icaos must be a non-empty array');
  }
  const ids = icaos.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  const csv = encodeURIComponent(ids.join(','));
  const metarUrl = `https://aviationweather.gov/api/data/metar?ids=${csv}&format=json`;
  const tafUrl = `https://aviationweather.gov/api/data/taf?ids=${csv}&format=json`;
  const [metars, tafs] = await Promise.all([fetchJson(metarUrl), fetchJson(tafUrl)]);

  const byId = new Map(ids.map((id) => [id, { icao: id, metar: null, taf: null }]));
  if (Array.isArray(metars)) {
    for (const m of metars) {
      const id = (m.icaoId || m.station_id || '').toUpperCase();
      if (!id || !byId.has(id)) continue;
      const entry = byId.get(id);
      // keep the freshest by reportTime if duplicates appear
      if (!entry.metar || (m.reportTime && m.reportTime > entry.metar.reportTime)) {
        entry.metar = {
          rawOb: m.rawOb ?? null,
          reportTime: m.reportTime ?? null,
          temp: m.temp ?? null,
          dewp: m.dewp ?? null,
          wdir: m.wdir ?? null,
          wspd: m.wspd ?? null,
          wgst: m.wgst ?? null,
          visib: m.visib ?? null,
          altim: m.altim ?? null,
          wxString: m.wxString ?? null,
          clouds: m.clouds ?? null,
        };
      }
    }
  }
  if (Array.isArray(tafs)) {
    for (const t of tafs) {
      const id = (t.icaoId || t.station_id || '').toUpperCase();
      if (!id || !byId.has(id)) continue;
      const entry = byId.get(id);
      entry.taf = {
        rawTAF: t.rawTAF ?? null,
        issueTime: t.issueTime ?? null,
        validTimeFrom: t.validTimeFrom ?? null,
        validTimeTo: t.validTimeTo ?? null,
      };
    }
  }
  return {
    airports: [...byId.values()],
    source: 'aviationweather.gov /api/data/metar + /api/data/taf',
  };
}

async function tool_list_aircraft() {
  const r = await listAircraft();
  const list = Array.isArray(r?.aircraft) ? r.aircraft : [];
  return {
    count: list.length,
    aircraft: list.map((a) => ({
      id: oid(a._id),
      tailNumber: a.tailNumber,
      serial: a.serial,
      type: a.type?.name ?? null,
      engines: a.type?.engines ?? null,
      airport: a.airport ?? null,
      paxSeats: a.paxSeats ?? null,
      active: a.active === true,
    })),
    source: 'LevelFlight GET /api/aircraft/list',
  };
}

async function tool_get_aircraft({ tail_or_id }) {
  let id = tail_or_id;
  if (!isObjectId(id)) {
    // resolve tail → _id via fleet list
    const list = await listAircraft();
    const match = (list?.aircraft || []).find((a) => eqTail(a.tailNumber, tail_or_id));
    if (!match) {
      throw new Error(`no aircraft found for "${tail_or_id}"`);
    }
    id = oid(match._id);
    if (!id) throw new Error(`aircraft "${tail_or_id}" has no _id`);
  }
  const r = await getAircraftById(id);
  return {
    aircraft: r?.aircraft ?? null,
    source: `LevelFlight GET /api/aircraft/${id}`,
  };
}

async function tool_get_aircraft_compliance({ tail, start_date, end_date }) {
  const startMs = parseDateUtc(start_date);
  const endMs = parseDateUtc(end_date, true);

  // Work orders scale fine with window size; tickets must be chunked.
  const [woResp, rawTickets] = await Promise.all([
    workOrdersRanged(startMs, endMs),
    ticketsOverRange(startMs, endMs),
  ]);

  const workOrders = (woResp?.workOrders || [])
    .map(normalizeWorkOrder)
    .filter((w) => w && eqTail(w.tailNumber, tail))
    .sort((a, b) => (b.end || b.start || 0) - (a.end || a.start || 0));

  const tickets = rawTickets
    .map(normalizeTicket)
    .filter((t) => t && eqTail(t.tailNumber, tail))
    .sort((a, b) => (b.eventDate || b.createdOn || 0) - (a.eventDate || a.createdOn || 0));

  return {
    tail,
    window: { start: startMs, end: endMs },
    counts: {
      work_orders_total: workOrders.length,
      work_orders_open: workOrders.filter((w) => w.status === 'open').length,
      tickets_total: tickets.length,
      tickets_open: tickets.filter((t) => t.lifecycle.status === 'open').length,
    },
    work_orders: workOrders,
    tickets,
    source: 'LevelFlight POST /api/workOrder/ranged + POST /api/analytics/tickets (chunked, 90d)',
  };
}

async function tool_get_crew_availability({ flight_id, start_date, end_date } = {}) {
  // Two modes:
  //   1) flight_id given — compute duty/rest analysis for the assigned crew
  //      of one specific flight. Fetches 365d back so cumulative windows
  //      (quarter / annual) have enough history.
  //   2) flight_id absent — original behavior: rollup of every crew member
  //      with activity in the user-supplied (or default 14-day) window.
  const now = Date.now();

  let proposedFlight = null;
  let dutyStart = null;
  let dutyEnd = null;
  let proposedFlightMs = 0;
  let fetchStart, fetchEnd, displayStart, displayEnd;

  if (flight_id) {
    // ForeFlight's per-flight detail endpoint (getFlight) wraps times
    // inside `flightData` and doesn't surface arrival as a top-level
    // field. The list endpoint returns each flight with flat
    // `departureTime` / `arrivalTime` ISO strings — use that for the
    // lookup. listFlights is the same call other tools already make.
    const listResp = await listFlights();
    proposedFlight = (listResp?.flights || []).find((f) => f.flightId === flight_id) || null;
    if (!proposedFlight) {
      throw new Error(`flight ${flight_id} not found in ForeFlight list`);
    }
    const dep = proposedFlight.departureTime ? Date.parse(proposedFlight.departureTime) : NaN;
    const arr = proposedFlight.arrivalTime ? Date.parse(proposedFlight.arrivalTime) : NaN;
    if (!Number.isFinite(dep) || !Number.isFinite(arr) || arr <= dep) {
      throw new Error(`flight ${flight_id} has no usable departure/arrival times`);
    }
    dutyStart = dep;
    dutyEnd = arr + POST_FLIGHT_BUFFER_MS;
    proposedFlightMs = arr - dep;
    fetchStart = dutyStart - 365 * DAY_MS;
    fetchEnd = end_date ? parseDateUtc(end_date, true) : dutyEnd + 14 * DAY_MS;
    displayStart = start_date ? parseDateUtc(start_date) : dutyStart - 7 * DAY_MS;
    displayEnd = end_date ? parseDateUtc(end_date, true) : dutyEnd + 7 * DAY_MS;
  } else {
    fetchStart = start_date ? parseDateUtc(start_date) : now;
    fetchEnd = end_date ? parseDateUtc(end_date, true) : now + 14 * DAY_MS;
    displayStart = fetchStart;
    displayEnd = fetchEnd;
  }

  const dutyDataPromise = flight_id
    ? dutyTimesOverRange(fetchStart, fetchEnd)
    : analyticsDutyTimes(fetchStart, fetchEnd)
        .then((r) => ({ dutyTimes: r?.dutyTimes || [], legs: r?.legs || [] }))
        .catch(() => ({ dutyTimes: [], legs: [] }));

  const [pilotsResp, dutyData, onDutyResp] = await Promise.all([
    listPilots(),
    dutyDataPromise,
    widgetsOnDuty({ start: fetchStart, end: fetchEnd }),
  ]);

  const allDutyTimes = dutyData.dutyTimes;
  const allLegs = dutyData.legs;

  // Pilot directory — for name/email/title.
  const pilots = (pilotsResp?.users || []).map((u) => {
    const id = oid(u._id);
    return {
      id,
      name: `${(u.firstName || '').trim()} ${(u.lastName || '').trim()}`.trim(),
      email: u.email ?? null,
      title: u.title ?? null,
    };
  });
  const byId = new Map(pilots.filter((p) => p.id).map((p) => [p.id, p]));

  // Match the LevelFlight leg that corresponds to the ForeFlight proposed
  // flight. Crew assignments live on the LF side; flight ID is on the FF
  // side. We match on (tail, departure, arrival, departure date UTC).
  let matchedLfLeg = null;
  let matchedLfLegId = null;
  if (proposedFlight) {
    matchedLfLeg = findMatchingLfLeg(allLegs, {
      tail: proposedFlight.aircraftRegistration,
      departure: proposedFlight.departure,
      destination: proposedFlight.destination,
      departureDate: proposedFlight.departureTime
        ? new Date(proposedFlight.departureTime).toISOString().slice(0, 10)
        : null,
    });
    matchedLfLegId = matchedLfLeg ? oid(matchedLfLeg._id) : null;
  }

  // Per-crew rollup keyed by user id. `_legs` is scratch — stripped from
  // the returned object before serializing.
  const crewMap = new Map();
  const getOrCreate = (id, fallback) => {
    if (!id) return null;
    let row = crewMap.get(id);
    if (!row) {
      const profile = byId.get(id);
      row = {
        pilot_id: id,
        name: profile?.name || fallback?.name || null,
        email: profile?.email || fallback?.email || null,
        role: profile?.title || fallback?.role || 'Crew',
        duty_total_hours: 0,
        duty_window_count: 0,
        last_duty_end: null,        // most recent duty END before duty_start (informational)
        assignments_in_window: [],
        _legs: [],                  // every leg this pilot is on (excl. proposed), used for cumulative + stacking
        _duty_periods: [],          // every {out, in} duty record, used for rest with effective duty start
      };
      crewMap.set(id, row);
    }
    return row;
  };

  // Duty periods: track total hours, count, and (when computing
  // duty/rest) the most recent duty END that falls before duty_start.
  for (const dw of allDutyTimes) {
    const id = oid(dw.user);
    if (!id) continue;
    const row = getOrCreate(id);
    if (!row) continue;
    if (typeof dw.out !== 'number' || typeof dw.in !== 'number' || dw.in <= dw.out) continue;
    row.duty_total_hours += (dw.in - dw.out) / HOUR_MS;
    row.duty_window_count += 1;
    row._duty_periods.push({ out: dw.out, in: dw.in });
    const eligible = dutyStart == null || dw.in <= dutyStart;
    if (eligible && (row.last_duty_end == null || dw.in > row.last_duty_end)) {
      row.last_duty_end = dw.in;
    }
  }

  // Legs: drive both the display-window "assignments_in_window" list and
  // the full-history `_legs` set used for cumulative flight time.
  for (const leg of allLegs) {
    const tail = leg?.dispatch?.aircraft?.tailNumber ?? null;
    const from = leg?.departure?.airport ?? null;
    const to = leg?.arrival?.airport ?? null;
    const start = leg?.departure?.time ?? null;
    const end = leg?.arrival?.time ?? null;
    const route = from && to ? `${from} → ${to}` : null;
    const legId = oid(leg?._id);
    const inDisplay = typeof start === 'number' && start >= displayStart && start <= displayEnd;
    const usableForCumulative = typeof start === 'number' && typeof end === 'number' && end > start;
    // Skip the matched proposed leg in cumulative — we add it back below
    // as a synthetic leg so it always contributes its full planned flight
    // time, even if the data store lacks a recorded duration yet.
    const skipForCumulative = matchedLfLegId && legId === matchedLfLegId;

    const onLeg = [];
    for (const p of leg?.pilots || []) {
      const id = oid(p?.user?._id);
      if (id) onLeg.push({
        id,
        name: `${(p.user.firstName || '').trim()} ${(p.user.lastName || '').trim()}`.trim(),
        email: p.user.email ?? null,
        role: 'Pilot',
      });
    }
    for (const a of leg?.attendants || []) {
      const id = oid(a?.user?._id);
      if (id) onLeg.push({
        id,
        name: `${(a.user.firstName || '').trim()} ${(a.user.lastName || '').trim()}`.trim(),
        email: a.user.email ?? null,
        role: 'Flight Attendant',
      });
    }
    for (const c of onLeg) {
      const row = getOrCreate(c.id, c);
      if (!row) continue;
      // If the row was created from a dutyTimes entry first (no role
      // context), the leg now tells us they're a Pilot / Flight Attendant.
      // Upgrade in place so the output doesn't say "Crew" for someone we
      // already know is a Pilot.
      if (row.role === 'Crew' && c.role && c.role !== 'Crew') row.role = c.role;
      // Fill in name/email from the leg if the pilot directory didn't
      // carry them (flight attendants aren't in /api/pilots/list).
      if (!row.name && c.name) row.name = c.name;
      if (!row.email && c.email) row.email = c.email;
      if (inDisplay) row.assignments_in_window.push({ legId, tail, route, start, end });
      if (usableForCumulative && !skipForCumulative) {
        row._legs.push({ start, end, legId, from, to, ffId: leg?.foreflight?.flightId || null });
      }
    }
  }

  for (const row of crewMap.values()) {
    row.assignments_in_window.sort((a, b) => (a.start || 0) - (b.start || 0));
    row.duty_total_hours = Math.round(row.duty_total_hours * 10) / 10;
    row.has_conflict = false;
    for (let i = 1; i < row.assignments_in_window.length; i++) {
      const prev = row.assignments_in_window[i - 1];
      const curr = row.assignments_in_window[i];
      if (prev.end != null && curr.start != null && curr.start < prev.end) {
        row.has_conflict = true;
        break;
      }
    }
  }

  // Crew assigned to the proposed flight (from the matched LF leg). Used
  // both to filter the returned `crew` array and to scope duty/rest
  // computation to the pilots who actually matter.
  let assignedPilotIds = null;
  if (matchedLfLeg) {
    assignedPilotIds = new Set();
    for (const p of matchedLfLeg?.pilots || []) {
      const id = oid(p?.user?._id);
      if (id) assignedPilotIds.add(id);
    }
    for (const a of matchedLfLeg?.attendants || []) {
      const id = oid(a?.user?._id);
      if (id) assignedPilotIds.add(id);
    }
  }

  if (dutyStart != null && dutyEnd != null) {
    // Proposed leg as a synthetic entry — used for both grouping into a
    // duty period and cumulative flight-time computation. _legs already
    // excludes the proposed leg (skipForCumulative), so adding it here
    // doesn't double-count.
    const proposedLegSynthetic = {
      start: dutyStart,
      end: dutyStart + proposedFlightMs,
      legId: matchedLfLegId,
      ffId: flight_id,
      from: proposedFlight?.departure || null,
      to: proposedFlight?.destination || null,
      isProposed: true,
    };
    const restThresholdMs = DUTY_REST_THRESHOLDS.rest_required_hours * HOUR_MS;
    const STACK_HALF_WINDOW_MS = 24 * HOUR_MS;

    for (const row of crewMap.values()) {
      if (assignedPilotIds && !assignedPilotIds.has(row.pilot_id)) continue;

      // Group the pilot's nearby legs (plus the proposed) into duty
      // periods. Two consecutive legs belong to the same duty period
      // when the gap between them is shorter than the required rest.
      // The "proposed duty period" is the group containing the proposed
      // leg — its full span drives duty_length and planned_flight_time.
      const nearby = row._legs.filter((l) =>
        l.end > dutyStart - STACK_HALF_WINDOW_MS &&
        l.start < (dutyStart + proposedFlightMs) + STACK_HALF_WINDOW_MS,
      );
      const candidates = [...nearby, proposedLegSynthetic].sort((a, b) => a.start - b.start);
      const groups = [];
      for (const leg of candidates) {
        const last = groups.length ? groups[groups.length - 1] : null;
        const tail = last ? last[last.length - 1] : null;
        if (last && tail && (leg.start - tail.end) < restThresholdMs) {
          last.push(leg);
        } else {
          groups.push([leg]);
        }
      }
      const dutyPeriod = groups.find((g) => g.some((l) => l.isProposed)) || [proposedLegSynthetic];

      const effectiveDutyStart = dutyPeriod[0].start;
      const effectiveDutyEnd = dutyPeriod[dutyPeriod.length - 1].end + POST_FLIGHT_BUFFER_MS;
      const plannedFlightMsStacked = dutyPeriod.reduce((s, l) => s + (l.end - l.start), 0);
      const isMultiLeg = dutyPeriod.length > 1;

      const dutyHours = Math.round(((effectiveDutyEnd - effectiveDutyStart) / HOUR_MS) * 10) / 10;
      const dutyCheck = classifyVsLimit(dutyHours, DUTY_REST_THRESHOLDS.duty_time_max_hours);

      // Cumulative windows anchor at the duty period's END so every leg
      // in the duty period falls inside the 24h bracket. row._legs
      // already contains the other stacked legs (only the proposed leg
      // was excluded); the synthetic adds the proposed contribution.
      const windows = buildFlightTimeWindows(effectiveDutyEnd);
      const cumulative = computeCumulative(row._legs, windows, proposedLegSynthetic);

      // Rest hours = effectiveDutyStart − (end of most recent prior duty period).
      // Cutoff is the duty period's earliest leg, not the proposed leg
      // alone — so legs stacked with the proposed (same duty period)
      // never falsely shorten rest.
      //
      // Two sources for the prior duty endpoint:
      //   1) LF dutyTimes record ending before effectiveDutyStart (authoritative).
      //   2) Leg arrival + post-flight buffer (estimate, used when LF
      //      dutyTimes is sparse — common: future-scheduled pilots have
      //      flown legs but no checked-out duty period yet).
      // Pick whichever timestamp is more recent.
      let dutyEndCandidate = null;
      for (const dw of row._duty_periods) {
        if (typeof dw.in !== 'number' || dw.in > effectiveDutyStart) continue;
        if (dutyEndCandidate == null || dw.in > dutyEndCandidate) dutyEndCandidate = dw.in;
      }
      let legArrivalCandidate = null;
      for (const leg of row._legs) {
        if (typeof leg.end !== 'number' || leg.end >= effectiveDutyStart) continue;
        if (legArrivalCandidate == null || leg.end > legArrivalCandidate) legArrivalCandidate = leg.end;
      }
      const legEstimateCandidate = legArrivalCandidate != null
        ? legArrivalCandidate + POST_FLIGHT_BUFFER_MS
        : null;

      let lastDutyEnd = null;
      let restSource = 'no_data';
      if (dutyEndCandidate != null && legEstimateCandidate != null) {
        if (dutyEndCandidate >= legEstimateCandidate) {
          lastDutyEnd = dutyEndCandidate; restSource = 'duty_times';
        } else {
          lastDutyEnd = legEstimateCandidate; restSource = 'leg_estimate';
        }
      } else if (dutyEndCandidate != null) {
        lastDutyEnd = dutyEndCandidate; restSource = 'duty_times';
      } else if (legEstimateCandidate != null) {
        lastDutyEnd = legEstimateCandidate; restSource = 'leg_estimate';
      }

      const restHours = lastDutyEnd != null
        ? Math.round(((effectiveDutyStart - lastDutyEnd) / HOUR_MS) * 10) / 10
        : null;
      // 'unknown' on missing data — never 'insufficient'. The spec is
      // explicit: don't claim a violation we couldn't measure.
      const restStatus = restHours == null
        ? 'unknown'
        : (restHours < DUTY_REST_THRESHOLDS.rest_required_hours ? 'insufficient' : 'compliant');

      const violations = [];
      const advisories = [];
      const recordCheck = (metric, value, limit, status, pct) => {
        if (status === 'violation') violations.push({ metric, value, limit });
        else if (status === 'advisory') advisories.push({ metric, value, limit, pct });
      };
      recordCheck('duty_length', dutyHours, DUTY_REST_THRESHOLDS.duty_time_max_hours, dutyCheck.status, dutyCheck.pct);
      for (const [key, val] of Object.entries(cumulative)) {
        recordCheck(key, val.hours, val.limit, val.status, val.pct);
      }
      if (restStatus === 'insufficient') {
        violations.push({ metric: 'rest', value: restHours, limit: DUTY_REST_THRESHOLDS.rest_required_hours });
      }

      let summary = 'compliant';
      if (violations.length > 0) summary = 'violation';
      else if (advisories.length > 0) summary = 'advisory';

      row.duty_rest = {
        proposed: {
          duty_start: effectiveDutyStart,
          duty_end: effectiveDutyEnd,
          planned_flight_time_hours: Math.round((plannedFlightMsStacked / HOUR_MS) * 10) / 10,
          is_multi_leg: isMultiLeg,
          legs_in_duty: dutyPeriod.map((l) => ({
            flight_id: l.ffId || null,
            departure: l.from || null,
            arrival: l.to || null,
            departure_time: l.start,
            arrival_time: l.end,
            flight_time_hours: Math.round(((l.end - l.start) / HOUR_MS) * 10) / 10,
            is_proposed: l.isProposed === true,
          })),
        },
        duty_length: { hours: dutyHours, limit: DUTY_REST_THRESHOLDS.duty_time_max_hours, status: dutyCheck.status },
        cumulative: Object.fromEntries(
          Object.entries(cumulative).map(([k, v]) => [k, { hours: v.hours, limit: v.limit, status: v.status }]),
        ),
        rest: {
          hours_since_last_duty: restHours,
          required: DUTY_REST_THRESHOLDS.rest_required_hours,
          status: restStatus,
          source: restSource,
        },
        violations,
        advisories,
        summary,
      };
    }
  }

  // Strip the scratch fields before returning.
  for (const row of crewMap.values()) {
    delete row._legs;
    delete row._duty_periods;
  }

  // On-duty (current snapshot) — compact, same shape as before.
  const onDuty = (Array.isArray(onDutyResp?.duties) ? onDutyResp.duties : []).map((d) => {
    const user = d?.user || {};
    const id = oid(user._id);
    return {
      pilot_id: id,
      name: `${(user.firstName || '').trim()} ${(user.lastName || '').trim()}`.trim(),
      email: user.email ?? null,
      dutyStart: d?.start ?? null,
    };
  });

  // With flight_id: return only the proposed flight's crew. Without:
  // return everyone with activity in the window (original behavior).
  let crew;
  if (assignedPilotIds) {
    crew = [...crewMap.values()].filter((r) => assignedPilotIds.has(r.pilot_id));
  } else {
    crew = [...crewMap.values()];
  }
  crew.sort((a, b) => (b.duty_total_hours || 0) - (a.duty_total_hours || 0));

  const proposed = proposedFlight ? {
    flight_id,
    tail: proposedFlight.aircraftRegistration || null,
    route: proposedFlight.departure && proposedFlight.destination
      ? `${proposedFlight.departure} → ${proposedFlight.destination}`
      : null,
    duty_start: dutyStart,
    duty_end: dutyEnd,
    lf_leg_id: matchedLfLegId,
    crew_assignment_status: matchedLfLeg ? 'matched' : 'no_lf_leg_matched_for_flight',
  } : null;

  return {
    window: { start: displayStart, end: displayEnd },
    proposed_flight: proposed,
    thresholds: flight_id ? DUTY_REST_THRESHOLDS : undefined,
    counts: {
      pilots_in_directory: pilots.length,
      crew_in_scope: crew.length,
      crew_with_conflict: crew.filter((c) => c.has_conflict).length,
      crew_with_duty_violation: crew.filter((c) => c.duty_rest?.summary === 'violation').length,
      crew_with_duty_advisory: crew.filter((c) => c.duty_rest?.summary === 'advisory').length,
      on_duty_now: onDuty.length,
    },
    crew,
    on_duty_now: onDuty,
    source:
      'LevelFlight GET /api/pilots/list + POST /api/analytics/dutyTimes' +
      (flight_id ? ' (chunked 90d)' : '') +
      ' + POST /api/widgets/onDuty' +
      (flight_id ? ` + ForeFlight GET /public/api/Flights/${flight_id}` : ''),
  };
}

async function tool_get_airport_safety_history({ icao, years } = {}) {
  const id = String(icao || '').trim().toUpperCase();
  if (!id) throw new Error('icao is required');
  const lookbackYears = Number.isFinite(years) && years > 0 ? years : 3;
  const endMs = Date.now();
  const startMs = endMs - Math.round(lookbackYears * 365 * DAY_MS);

  // /api/analytics/tickets silently truncates on wide windows — chunk it.
  const raw = await ticketsOverRange(startMs, endMs);
  const matches = raw
    .filter((t) => ticketMentionsIcao(t, id))
    .map(normalizeTicket)
    .filter(Boolean)
    .sort((a, b) => (b.eventDate || b.createdOn || 0) - (a.eventDate || a.createdOn || 0));

  return {
    icao: id,
    window: { start: startMs, end: endMs, lookback_years: lookbackYears },
    count: matches.length,
    tickets: matches,
    source: 'LevelFlight POST /api/analytics/tickets (chunked 90d, scanned for ICAO mention)',
  };
}

// Search the ingested operational manuals (pgvector / Voyage embeddings).
// Embeds the query, calls the match_manual_chunks RPC defined in
// migration 003, returns the top chunks with manual name, section, and
// page number. Cap top_k at 5 (the RPC also clamps, but enforce here so
// the tool result is consistent).
async function tool_search_manuals({ query, manual, top_k } = {}) {
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('query is required');
  }
  const k = Math.max(1, Math.min(5, Number.isFinite(top_k) ? Math.round(top_k) : 3));
  const [queryEmbedding] = await embed([query], { inputType: 'query' });
  if (!Array.isArray(queryEmbedding)) {
    throw new Error('embedding service returned no vector');
  }

  const client = getSupabaseForSearch();
  const { data, error } = await client.rpc('match_manual_chunks', {
    query_embedding: queryEmbedding,
    match_count: k,
    manual_filter: manual || null,
  });
  if (error) throw new Error(`vector search failed: ${error.message}`);

  const matches = (Array.isArray(data) ? data : []).map((r) => ({
    manual: r.manual_name,
    section: r.section,
    page: r.page_number,
    content: r.content,
    score: typeof r.score === 'number' ? Number(r.score.toFixed(4)) : null,
  }));

  return {
    query,
    matches,
    count: matches.length,
    source: 'Supabase manual_chunks (pgvector cosine) + Voyage embeddings',
  };
}

/* ─────────────── dispatcher ─────────────── */

const handlers = {
  list_flights: tool_list_flights,
  get_flight: tool_get_flight,
  get_performance: tool_get_performance,
  get_runway_analysis: tool_get_runway_analysis,
  get_weather_briefing: tool_get_weather_briefing,
  get_airport_weather: tool_get_airport_weather,
  list_aircraft: tool_list_aircraft,
  get_aircraft: tool_get_aircraft,
  get_aircraft_compliance: tool_get_aircraft_compliance,
  get_crew_availability: tool_get_crew_availability,
  get_airport_safety_history: tool_get_airport_safety_history,
  search_manuals: tool_search_manuals,
};

export async function executeTool(name, input) {
  // render_review is a structural "I'm done — here is the structured review"
  // signal. The agent loop captures the input and terminates; this no-op is
  // a defensive fallback in case anything else dispatches it.
  if (name === RENDER_REVIEW_TOOL) return { ok: true };
  const fn = handlers[name];
  if (!fn) return { error: `unknown tool: ${name}` };
  try {
    return await fn(input || {});
  } catch (e) {
    return { error: e?.message || String(e) };
  }
}

export { toolNames, RENDER_REVIEW_TOOL };
