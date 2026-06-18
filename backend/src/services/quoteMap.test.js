import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapDispatchToQuote } from './quoteMap.js';

const dispatch = {
  _id: { $oid: '69fb575a2900002600b1e1bd' },
  aircraft: { tailNumber: 'N69FP', type: { name: 'Gulfstream GIV-SP' } },
  _internal: { price: { breakdown: { calculatedTotal: 232105 }, total: 232105 } },
  legs: [
    { departure: { airport: 'EHAM', time: 1000 }, arrival: { airport: 'LGAV', time: 2000 }, distance: 1179, pax: 15 },
    { departure: { airport: 'LGAV', time: 3000 }, arrival: { airport: 'LGKR', time: 4000 }, distance: 214, pax: 15 },
  ],
};

test('maps tail, type, total and accept id', () => {
  const q = mapDispatchToQuote(dispatch);
  assert.equal(q.tail, 'N69FP');
  assert.equal(q.aircraftType, 'Gulfstream GIV-SP');
  assert.equal(q.total, 232105);
  assert.equal(q.acceptId, '69fb575a2900002600b1e1bd');
  assert.equal(q.dispatchId, '69fb575a2900002600b1e1bd');
});

test('maps legs with airports, times, distance, pax', () => {
  const q = mapDispatchToQuote(dispatch);
  assert.equal(q.legs.length, 2);
  assert.deepEqual(
    { from: q.legs[0].from, to: q.legs[0].to, dep: q.legs[0].depTime, arr: q.legs[0].arrTime, dist: q.legs[0].distance, pax: q.legs[0].pax },
    { from: 'EHAM', to: 'LGAV', dep: 1000, arr: 2000, dist: 1179, pax: 15 },
  );
});

test('total is null when LevelFlight has no price (do not fabricate)', () => {
  const q = mapDispatchToQuote({ ...dispatch, _internal: {} });
  assert.equal(q.total, null);
});

test('prefers explicit clientAcceptId when present', () => {
  const q = mapDispatchToQuote({ ...dispatch, clientAcceptId: 'abc123' });
  assert.equal(q.acceptId, 'abc123');
});

// Real /api/dispatch/list shape: route in _internal.summary, times in order/end,
// aircraft.paxSeats — no detailed legs[] array.
test('derives legs/tail/pax/total from the real dispatch-list shape', () => {
  const real = {
    _id: { $oid: 'abc123' },
    _internal: {
      summary: 'KFXE, MDLR, KTMB, KFXE',
      order: 1803207660000,
      end: 1803231420000,
      price: { breakdown: { calculatedTotal: 45560 }, total: 45560 },
    },
    aircraft: { tailNumber: 'N69FP', type: { name: 'Gulfstream GIV SP' }, paxSeats: 15 },
  };
  const q = mapDispatchToQuote(real);
  assert.equal(q.tail, 'N69FP');
  assert.equal(q.maxPax, 15);
  assert.equal(q.total, 45560);
  assert.equal(q.legs.length, 3); // 4 airports -> 3 legs
  assert.deepEqual(q.legs.map((l) => [l.from, l.to]), [['KFXE','MDLR'],['MDLR','KTMB'],['KTMB','KFXE']]);
  assert.equal(q.legs[0].depTime, 1803207660000);          // first leg gets trip start
  assert.equal(q.legs[2].arrTime, 1803231420000);          // last leg gets trip end
  assert.equal(q.depTime, 1803207660000);
});
