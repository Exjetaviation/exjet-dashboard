// Unit tests for NTSB aggregation helpers. Run: node --test scripts/ntsbProfile.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decode, DAMAGE, broadPhase, isLightGaPistonSingle, isPart135Relevant,
  eventDamagePatterns, topN, buildPatternWarnings, buildAirportProfile,
} from './ntsbProfile.js';

test('decode maps known codes and passes through unknown/blank', () => {
  assert.equal(decode(DAMAGE, 'DEST'), 'Destroyed');
  assert.equal(decode(DAMAGE, 'XX'), 'XX');
  assert.equal(decode(DAMAGE, ''), null);
});

test('broadPhase takes the segment before " - "', () => {
  const map = { 560: 'Approach - VFR go-around', 570: 'Landing', 520: 'Takeoff' };
  assert.equal(broadPhase(560, map), 'Approach');
  assert.equal(broadPhase(570, map), 'Landing');
  assert.equal(broadPhase(999, map), null);
});

test('isLightGaPistonSingle excludes only clear light GA piston singles', () => {
  assert.equal(isLightGaPistonSingle({ make: 'Cessna', number_of_engines: 1, engine_type: 'Reciprocating' }), true);
  assert.equal(isLightGaPistonSingle({ make: 'Piper', number_of_engines: 1, engine_type: 'Reciprocating' }), true);
  // Turbine single (Caravan / PC-12) → kept.
  assert.equal(isLightGaPistonSingle({ make: 'Cessna', number_of_engines: 1, engine_type: 'Turboprop' }), false);
  // Twin jet → kept.
  assert.equal(isLightGaPistonSingle({ make: 'Cessna', number_of_engines: 2, engine_type: 'Turbofan' }), false);
  // Unknown make / unknown engine → kept (ambiguous).
  assert.equal(isLightGaPistonSingle({ make: '', number_of_engines: 1, engine_type: 'Reciprocating' }), false);
  assert.equal(isLightGaPistonSingle({ make: 'Cessna', number_of_engines: 1, engine_type: '' }), false);
  assert.equal(isPart135Relevant({ make: 'Gulfstream', number_of_engines: 2, engine_type: 'Turbofan' }), true);
});

test('eventDamagePatterns finds keyword patterns', () => {
  assert.deepEqual(eventDamagePatterns('The airplane overran the runway and the landing gear collapsed.'),
    ['runway excursion', 'gear']);
  assert.deepEqual(eventDamagePatterns('Controlled flight into terrain during approach.'), ['CFIT/terrain']);
  assert.deepEqual(eventDamagePatterns(''), []);
});

test('topN ranks by frequency and skips Unknown/blank', () => {
  assert.deepEqual(topN(['Landing', 'Landing', 'Takeoff', 'Unknown', '', 'Approach', 'Landing']), ['Landing', 'Takeoff', 'Approach']);
  assert.deepEqual(topN(['A', 'B', 'C', 'D'], 2), ['A', 'B']);
});

test('buildPatternWarnings fires only at 2+ and qualifies wet excursions', () => {
  const relevant = [
    { weather_condition: 'IMC', _patterns: ['runway excursion'] },
    { weather_condition: 'IMC', _patterns: ['runway excursion'] },
    { weather_condition: 'VMC', _patterns: ['runway excursion'] },
  ];
  const damageCounts = new Map([['runway excursion', 3]]);
  const phaseCounts = new Map([['Landing', 3]]);
  const w = buildPatternWarnings({ relevant, damageCounts, phaseCounts, imcCount: 2, fatalCount: 2 });
  assert.ok(w.some((s) => s.includes('3 runway excursions recorded, 2 in IMC')), JSON.stringify(w));
  assert.ok(w.some((s) => s.includes('2 fatal accidents')));
  assert.ok(w.some((s) => s.includes('during landing phase')));
  assert.ok(w.some((s) => s.includes('IMC')));
  // sparse → nothing
  assert.deepEqual(buildPatternWarnings({ relevant: [{ _patterns: [] }], damageCounts: new Map(), phaseCounts: new Map() }), []);
});

test('buildAirportProfile produces a compact, correct profile', () => {
  const rows = [
    { ntsb_number: 'A1', event_date: '2024-05-01', make: 'Gulfstream', model: 'G550', number_of_engines: 2, engine_type: 'Turbofan', injury_severity: 'Fatal', aircraft_damage: 'Destroyed', weather_condition: 'IMC', broad_phase_of_flight: 'Approach', probable_cause: 'controlled flight into terrain', narrative: '', airport_name: 'Test Rgnl', state: 'FL' },
    { ntsb_number: 'A2', event_date: '2023-03-01', make: 'Learjet', model: '45', number_of_engines: 2, engine_type: 'Turbofan', injury_severity: 'None', aircraft_damage: 'Substantial', weather_condition: 'IMC', broad_phase_of_flight: 'Approach', probable_cause: 'impact with terrain', narrative: '', airport_name: 'Test Rgnl', state: 'FL' },
    { ntsb_number: 'A3', event_date: '2022-01-01', make: 'Cessna', model: '172', number_of_engines: 1, engine_type: 'Reciprocating', injury_severity: 'Minor', aircraft_damage: 'Substantial', weather_condition: 'VMC', broad_phase_of_flight: 'Landing', probable_cause: 'hard landing', narrative: '', airport_name: 'Test Rgnl', state: 'FL' },
  ];
  const p = buildAirportProfile('TST', rows, '2024-06-01');
  assert.equal(p.airport_code, 'TST');
  assert.equal(p.total_events, 3);
  assert.equal(p.fatal_events, 1);
  assert.equal(p.part135_relevant_events, 2); // Cessna 172 piston single excluded
  assert.deepEqual(p.top_phases, ['Approach']);
  assert.deepEqual(p.top_weather_conditions, ['IMC']);
  assert.deepEqual(p.top_damage_patterns, ['CFIT/terrain']);
  assert.equal(p.recent_events.length, 2);
  assert.equal(p.recent_events[0].ntsb_number, 'A1');
  assert.equal(p.last_event_date, '2024-05-01');
  assert.equal(p.data_through, '2024-06-01');
  assert.ok(p.pattern_warnings.some((s) => s.includes('CFIT/terrain')));

  // Regression: must NOT leak the internal _patterns field onto input rows —
  // those objects get upserted into ntsb_raw, which has no such column.
  for (const r of rows) assert.ok(!('_patterns' in r), 'input row was mutated with _patterns');
});
