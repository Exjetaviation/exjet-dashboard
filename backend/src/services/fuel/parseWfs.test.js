import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWfs } from './parseWfs.js';

const CSV = `"Country/State","City","ICAO","Supplier","Gal From","Gal To","Exp Date","Estimated Price","Estimated Taxes","Estimated Total Price","Pre- Arr Req","Notes"
"Florida","FORT LAUDERDALE","KFXE","BANYAN AIR SERVICE","1","999999999","04-Jun-26","7.10","0.50","7.60",,"misc **Price for fuel item: JET FUEL**/contact fuel24@wfscorp.com"
"Florida","FORT LAUDERDALE","KFXE","BANYAN AIR SERVICE","1","999999999","04-Jun-26","7.30","0","7.30",,"**Price for fuel item: JETA-ADDITIVE**/note"
"Florida","MIAMI","KMIA","SOME FBO","1","2","04-Jun-26","8.00","0","8.00",,"no fuel item pattern here"
"Florida","ORLANDO","KORL","BLANK PRICE","1","2","04-Jun-26","","0","",,"**Price for fuel item: JET FUEL**"
"Florida","FORT LAUDERDALE","KFLL","NONNUM PRICE","1","2","04-Jun-26","x","0","x",,"junk"
"Bad","Row","","NO ICAO","1","2","04-Jun-26","9.00","0","9.00",,"skip: no icao"`;

test('parseWfs maps columns, extracts fuel type, parses date, skips bad rows', () => {
  const rows = parseWfs(CSV, { sourceFile: 'WFS FUEL.csv', effectiveDate: '2026-06-23' });
  // KFXE x2 + KMIA kept; KORL (blank price), KFLL (non-numeric), no-ICAO skipped
  assert.equal(rows.length, 3);
  const a = rows[0];
  assert.equal(a.vendor, 'wfs');
  assert.equal(a.icao, 'KFXE');
  assert.equal(a.fbo_name, 'BANYAN AIR SERVICE');
  assert.equal(a.fuel_type, 'JET FUEL');
  assert.equal(a.tier_from_gal, 1);
  assert.equal(a.tier_to_gal, 999999999);
  assert.equal(a.price, 7.1);
  assert.equal(a.taxes, 0.5);
  assert.equal(a.total_price, 7.6);
  assert.equal(a.exp_date, '2026-06-04');
  assert.equal(a.country, 'Florida');
  assert.equal(a.effective_date, '2026-06-23');
  assert.equal(rows[1].fuel_type, 'JETA-ADDITIVE');
  assert.equal(rows[2].icao, 'KMIA');
  assert.equal(rows[2].fuel_type, null); // Notes without the fuel-item pattern
});

test('parseWfsDate is case-insensitive for the month', () => {
  const csv = `"Country/State","City","ICAO","Supplier","Gal From","Gal To","Exp Date","Estimated Price","Estimated Taxes","Estimated Total Price","Pre- Arr Req","Notes"
"FL","X","KTPA","FBO","1","2","04-JAN-26","8.00","0","8.00",,"n"`;
  assert.equal(parseWfs(csv, {})[0].exp_date, '2026-01-04');
});
