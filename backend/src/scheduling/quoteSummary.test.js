// backend/src/scheduling/quoteSummary.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteSummary } from './quoteSummary.js';

const leg = (dep, arr, depT, arrT) => ({
  departure: { airport: dep, time: depT },
  arrival: { airport: arr, time: arrT },
  dispatch: { aircraft: { tailNumber: 'N69FP' }, client: { company: { name: 'Acme Co' } } },
});

test('quoteSummary builds route, tail, customer, dates, leg count', () => {
  const s = quoteSummary([leg('KFXE', 'KTEB', 100, 200), leg('KTEB', 'KFXE', 300, 400)]);
  assert.equal(s.route, 'KFXE → KTEB → KFXE');
  assert.equal(s.tail, 'N69FP');
  assert.equal(s.customer, 'Acme Co');
  assert.equal(s.start, 100);
  assert.equal(s.end, 400);
  assert.equal(s.legCount, 2);
});

test('quoteSummary handles empty and null-filled input', () => {
  const empty = quoteSummary([]);
  assert.equal(empty.route, null);
  assert.equal(empty.legCount, 0);
  assert.equal(quoteSummary([null, leg('KFXE', 'KMIA', 1, 2)]).legCount, 1);
});
