#!/usr/bin/env node
// Smoke test: call each agent tool once against the live APIs and print a summary.
// Usage:   node scripts/test-tools.js
// Loads the backend .env automatically (the script lives in backend/scripts/).

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeTool } from '../src/agent/tools/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DAY = 86400000;
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const start = iso(new Date(today.getTime() - 30 * DAY));
const end = iso(new Date(today.getTime() + 60 * DAY));

function preview(value, max = 600) {
  let s;
  try { s = JSON.stringify(value, null, 2); } catch { s = String(value); }
  if (s.length > max) s = s.slice(0, max) + `\n… (truncated, ${s.length} chars total)`;
  return s;
}

function sizeKB(value) {
  try { return Math.round(JSON.stringify(value).length / 1024 * 10) / 10; } catch { return -1; }
}

async function run(name, label, input) {
  const t0 = Date.now();
  const result = await executeTool(name, input);
  const ms = Date.now() - t0;
  const ok = result && !result.error;
  const icon = ok ? '✓' : '✗';
  const kb = ok ? sizeKB(result) : 0;
  console.log(`\n── ${icon} ${name}  (${ms}ms, ${kb} KB) — ${label}`);
  if (!ok) {
    console.log(`   error: ${result?.error || 'unknown'}`);
  } else {
    console.log(`   source: ${result.source || '(none)'}`);
    const { source, ...rest } = result;
    console.log(preview(rest));
  }
  return { name, ok, ms, kb, result };
}

async function main() {
  console.log('================================================================');
  console.log('  Exjet Copilot — tool smoke test');
  console.log(`  Window: ${start} → ${end}`);
  console.log(`  Env file resolved from: ${path.join(__dirname, '..', '.env')}`);
  console.log('================================================================');

  const summary = [];

  // 1. list_flights — also harvests a flightId for the per-flight tools
  const flights = await run('list_flights', 'flights in window', {
    start_date: start,
    end_date: end,
  });
  summary.push(flights);
  const flightId =
    process.env.FF_FLIGHT_ID || flights.result?.flights?.[0]?.flightId || null;

  // 2-5. per-flight FF tools (skip gracefully if no flight available)
  if (flightId) {
    summary.push(await run('get_flight', `flightId=${flightId}`, { flight_id: flightId }));
    summary.push(await run('get_performance', `flightId=${flightId}`, { flight_id: flightId }));
    summary.push(await run('get_runway_analysis', `flightId=${flightId}`, { flight_id: flightId }));
    summary.push(await run('get_weather_briefing', `flightId=${flightId}`, { flight_id: flightId }));
  } else {
    console.log('\n⚠  No flightId available — skipping per-flight FF tools.');
    console.log('   Set FF_FLIGHT_ID in .env, or widen the date window.');
  }

  // 6. get_airport_weather — use departure+destination of the first flight if we have one
  const wxIcaos =
    flights.result?.flights?.[0]
      ? [flights.result.flights[0].departure, flights.result.flights[0].destination].filter(Boolean)
      : ['KORL', 'KMIA'];
  summary.push(await run('get_airport_weather', `icaos=${wxIcaos.join(',')}`, { icaos: wxIcaos }));

  // 7. list_aircraft — also harvests a tail for the next tools
  const fleet = await run('list_aircraft', 'fleet roster', {});
  summary.push(fleet);
  const sampleTail =
    process.env.LF_TAIL || fleet.result?.aircraft?.[0]?.tailNumber || 'N69FP';

  // 8. get_aircraft (by tail; the tool resolves to _id internally)
  summary.push(await run('get_aircraft', `tail=${sampleTail}`, { tail_or_id: sampleTail }));

  // 9. get_aircraft_compliance — verify against N69FP (probe-report has real WOs for it)
  const complianceTail = process.env.LF_COMPLIANCE_TAIL || 'N69FP';
  summary.push(
    await run('get_aircraft_compliance', `tail=${complianceTail}, ±730d (wide)`, {
      tail: complianceTail,
      start_date: iso(new Date(today.getTime() - 730 * DAY)),
      end_date: iso(new Date(today.getTime() + 30 * DAY)),
    }),
  );

  // 10. get_crew_availability — use the default 14-day window (no dates supplied)
  summary.push(await run('get_crew_availability', 'default 14-day window', {}));

  // 11. get_airport_safety_history — verify KFXE (probe-report has a runway-closure ticket)
  const safetyIcao = process.env.LF_SAFETY_ICAO || 'KFXE';
  summary.push(await run('get_airport_safety_history', `icao=${safetyIcao}, 3y`, { icao: safetyIcao }));

  // 12. unknown tool (should soft-fail)
  summary.push(await run('not_a_real_tool', 'expect { error }', {}));

  console.log('\n================================================================');
  const ok = summary.filter((r) => r.ok).length;
  console.log(`  ${ok}/${summary.length} tools returned non-error results`);
  for (const r of summary) {
    const kb = r.ok ? `${String(r.kb).padStart(5)} KB` : '   - KB';
    console.log(`   ${r.ok ? '✓' : '✗'}  ${r.name.padEnd(28)} ${String(r.ms).padStart(5)}ms   ${kb}`);
  }
  console.log('================================================================');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
