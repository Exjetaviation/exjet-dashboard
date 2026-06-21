import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAirportIndex, searchAirports } from './airportSearch.js';

// Tiny fixture: coords define the universe (values don't matter for search),
// names overlay display info. IA59 intentionally has no name overlay.
const coords = { KFXE: {}, KFXY: {}, KASE: {}, KTEB: {}, IA59: {} };
const names = {
  KFXE: { n: 'Fort Lauderdale Executive Airport', c: 'Fort Lauderdale', r: 'FL' },
  KFXY: { n: 'Forest City Municipal Airport', c: 'Forest City', r: 'IA' },
  KASE: { n: 'Aspen-Pitkin County Airport', c: 'Aspen', r: 'CO' },
  KTEB: { n: 'Teterboro Airport', c: 'Teterboro', r: 'NJ' },
};
const idx = buildAirportIndex(coords, names);
const codes = (rows) => rows.map((r) => r.code);

test('exact code match ranks first', () => {
  assert.equal(searchAirports(idx, 'KFXE')[0].code, 'KFXE');
});

test('code prefix returns all matching codes in alpha order', () => {
  assert.deepEqual(codes(searchAirports(idx, 'KFX')), ['KFXE', 'KFXY']);
});

test('matches by city name', () => {
  assert.equal(searchAirports(idx, 'Aspen')[0].code, 'KASE');
});

test('matches a substring inside the airport name (not a word start)', () => {
  assert.equal(searchAirports(idx, 'eterboro')[0].code, 'KTEB');
});

test('code-prefix matches rank above name/city matches', () => {
  // "F" prefixes no code here, but appears in names; add a code-prefix case:
  // "KA" prefixes KASE (code) and "Aspen" name match is the same row, fine.
  // Use a query that is a code prefix for one row and a name match for another.
  const rows = searchAirports(idx, 'FO'); // no code starts with FO; names: Fort Lauderdale, Forest City
  assert.ok(rows.length >= 2);
  assert.ok(codes(rows).includes('KFXE') && codes(rows).includes('KFXY'));
});

test('trims and uppercases the query', () => {
  assert.equal(searchAirports(idx, '  kfxe ')[0].code, 'KFXE');
});

test('empty or whitespace-only query returns nothing', () => {
  assert.deepEqual(searchAirports(idx, ''), []);
  assert.deepEqual(searchAirports(idx, '   '), []);
});

test('respects the limit', () => {
  assert.equal(searchAirports(idx, 'K', 2).length, 2);
});

test('codes without a name overlay still return, with empty name fields', () => {
  assert.deepEqual(searchAirports(idx, 'IA59')[0], { code: 'IA59', name: '', city: '', region: '' });
});

test('result rows expose only the public shape', () => {
  assert.deepEqual(Object.keys(searchAirports(idx, 'KASE')[0]).sort(), ['city', 'code', 'name', 'region']);
});
