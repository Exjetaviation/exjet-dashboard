#!/usr/bin/env node
// Smoke test for the duty/rest analysis added to get_crew_availability.
//
//   node scripts/test-crew-duty-rest.js
//   node scripts/test-crew-duty-rest.js <flightId>     # specific flight
//
// Without an arg, finds the next upcoming flight that already has at
// least one pilot assigned, and runs get_crew_availability against it.

import 'dotenv/config';
import { executeTool } from '../src/agent/tools/index.js';
import { listFlights } from '../src/agent/providers/foreflight.js';

function pickFlightId() {
  return process.argv[2] || null;
}

async function findUpcomingWithCrew() {
  const resp = await listFlights();
  const flights = Array.isArray(resp?.flights) ? resp.flights : [];
  const now = Date.now();
  const upcoming = flights
    .filter((f) => f.flightId && f.departureTime && Date.parse(f.departureTime) >= now)
    .sort((a, b) => Date.parse(a.departureTime) - Date.parse(b.departureTime));
  // Prefer flights that already list crew. Fall back to the first upcoming
  // even if its crew array looks empty in the ForeFlight summary (the LF
  // leg may still carry crew assignments).
  const withCrew = upcoming.find((f) => Array.isArray(f.crew) && f.crew.length > 0);
  return withCrew || upcoming[0] || null;
}

function fmtTime(ms) {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  return d.toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}

function row(label, value, indent = 0) {
  console.log(`${' '.repeat(indent)}${label.padEnd(28 - indent)} ${value}`);
}

function statusIcon(s) {
  return s === 'violation' ? '✗ violation' : s === 'advisory' ? '⚠ advisory' : s === 'insufficient' ? '✗ insufficient' : s === 'unknown' ? '? unknown' : '✓ compliant';
}

async function main() {
  let flightId = pickFlightId();
  if (!flightId) {
    const f = await findUpcomingWithCrew();
    if (!f) { console.error('no upcoming flights found'); process.exit(1); }
    flightId = f.flightId;
    console.log(`(auto-picked next upcoming: ${f.aircraftRegistration} ${f.departure}→${f.destination} on ${f.departureTime})\n`);
  }

  const r = await executeTool('get_crew_availability', { flight_id: flightId });
  if (r?.error) { console.error('TOOL ERROR:', r.error); process.exit(2); }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`flight ${flightId}`);
  console.log('═══════════════════════════════════════════════════════════════');
  if (r.proposed_flight) {
    row('Tail / Route', `${r.proposed_flight.tail} · ${r.proposed_flight.route}`);
    row('Duty start',    fmtTime(r.proposed_flight.duty_start));
    row('Duty end',      fmtTime(r.proposed_flight.duty_end));
    row('Crew assignment', r.proposed_flight.crew_assignment_status);
  }
  console.log();
  row('Counts', JSON.stringify(r.counts));
  console.log();

  if (!r.crew?.length) {
    console.log('(no crew matched the proposed flight)');
    return;
  }

  for (const p of r.crew) {
    console.log('───────────────────────────────────────────────────────────────');
    console.log(`${p.name || '(unknown)'}  · ${p.role}  · ${p.email || ''}`);
    console.log(`  has_conflict: ${p.has_conflict}   assignments_in_window: ${p.assignments_in_window.length}`);
    const dr = p.duty_rest;
    if (!dr) { console.log('  (no duty_rest block)'); continue; }
    console.log();
    row('Proposed duty length', `${dr.duty_length.hours}h / ${dr.duty_length.limit}h  ${statusIcon(dr.duty_length.status)}`, 2);
    row('Planned flight time',  `${dr.proposed.planned_flight_time_hours}h`, 2);
    if (dr.proposed.is_multi_leg) {
      console.log(`  Duty period legs (${dr.proposed.legs_in_duty.length}):`);
      for (const l of dr.proposed.legs_in_duty) {
        const marker = l.is_proposed ? '  ← proposed' : '';
        console.log(`    - ${l.departure || '?'}→${l.arrival || '?'}  ${l.flight_time_hours}h  ff=${l.flight_id || '—'}${marker}`);
      }
    }
    console.log();
    console.log('  Cumulative flight time:');
    for (const [k, v] of Object.entries(dr.cumulative)) {
      row(k, `${v.hours}h / ${v.limit}h  ${statusIcon(v.status)}`, 4);
    }
    console.log();
    row('Rest since last duty', dr.rest.hours_since_last_duty != null
      ? `${dr.rest.hours_since_last_duty}h / ${dr.rest.required}h required  ${statusIcon(dr.rest.status)}  [${dr.rest.source}]`
      : `(no prior duty in history)  ${statusIcon(dr.rest.status)}  [${dr.rest.source}]`, 2);
    console.log();
    row('Summary', statusIcon(dr.summary), 2);
    // `rest` is a minimum (violation when below the limit); every other
    // metric is a maximum (violation when above). Print accordingly.
    if (dr.violations.length) {
      console.log('  Violations:');
      for (const v of dr.violations) {
        const cmp = v.metric === 'rest' ? '<' : '>';
        const label = v.metric === 'rest' ? 'required min' : 'limit';
        console.log(`    - ${v.metric}: ${v.value} ${cmp} ${v.limit} ${label}`);
      }
    }
    if (dr.advisories.length) {
      console.log('  Advisories:');
      for (const a of dr.advisories) console.log(`    - ${a.metric}: ${a.value} / ${a.limit} (${a.pct}%)`);
    }
    console.log();
  }
}

main().catch((e) => {
  console.error('FATAL:', e?.message || e);
  process.exit(1);
});
