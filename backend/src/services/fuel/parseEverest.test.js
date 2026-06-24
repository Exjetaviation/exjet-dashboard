import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEverest, everestDateFromFilename } from './parseEverest.js';

const CSV = `ICAO,FBO,TIER,PRICE,NAME,
07FA,OCEAN REEF CLUB,1,5.79000,,
9TE2,THE JL BAR RANCH,1,7.18729,BRAND X,
9TE2,THE JL BAR RANCH,251,7.08729,BRAND X,
,EMPTY ICAO,1,1.00,,`;

test('everestDateFromFilename extracts MM_DD_YYYY', () => {
  assert.equal(everestDateFromFilename('Everest Fuel_06_23_2026.csv'), '2026-06-23');
  assert.equal(everestDateFromFilename('nope.csv'), null);
});

test('parseEverest maps columns, tier floor, alt name, skips blank icao', () => {
  const rows = parseEverest(CSV, { sourceFile: 'Everest Fuel_06_23_2026.csv', effectiveDate: '2026-06-23' });
  assert.equal(rows.length, 3);
  const a = rows[0];
  assert.equal(a.vendor, 'everest');
  assert.equal(a.icao, '07FA');
  assert.equal(a.fbo_name, 'OCEAN REEF CLUB');
  assert.equal(a.fuel_type, 'JET-A');
  assert.equal(a.tier_from_gal, 1);
  assert.equal(a.tier_to_gal, null);
  assert.equal(a.price, 5.79);
  assert.equal(a.effective_date, '2026-06-23');
  assert.equal(rows[1].fbo_alt_name, 'BRAND X');
  assert.equal(rows[2].tier_from_gal, 251);
});
