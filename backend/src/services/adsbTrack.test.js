import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasMoved, detectTakeoff, clipTrackToLeg, normReg, monthAnchors, legTail, selectCompletedLegs, selectLegsToSnapshot } from './adsbTrack.js';

test('normReg canonicalizes case, dashes, and spaces', () => {
  assert.equal(normReg('n69fp'), 'N69FP');
  assert.equal(normReg('N-69FP'), 'N69FP');
  assert.equal(normReg(' N69FP '), 'N69FP');
  assert.equal(normReg(null), '');
});

test('hasMoved is false within threshold, true beyond it', () => {
  const a = { lat: 26.0, lon: -80.0 };
  assert.equal(hasMoved(a, { lat: 26.0001, lon: -80.0001 }, 0.01), false);
  assert.equal(hasMoved(a, { lat: 26.2, lon: -80.0 }, 0.01), true);
  assert.equal(hasMoved(null, a, 0.01), true);
});

test('detectTakeoff sets airborneSince on ground->air, clears on landing, carries otherwise', () => {
  assert.equal(detectTakeoff({ onGround: true, airborneSince: null }, { onGround: false, t: 1000 }), 1000);
  assert.equal(detectTakeoff({ onGround: false, airborneSince: 1000 }, { onGround: false, t: 2000 }), 1000);
  assert.equal(detectTakeoff({ onGround: false, airborneSince: 1000 }, { onGround: true, t: 3000 }), null);
  assert.equal(detectTakeoff(null, { onGround: false, t: 4000 }), null);
});

test('clipTrackToLeg keeps positions within the padded leg window, ordered by time', () => {
  const positions = [
    { lat: 1, lon: 1, t: 100 },
    { lat: 2, lon: 2, t: 200 },
    { lat: 3, lon: 3, t: 300 },
    { lat: 4, lon: 4, t: 400 },
  ];
  const leg = { depTime: 150, arrTime: 350 };
  assert.deepEqual(clipTrackToLeg(positions, leg, 0), [[2, 2], [3, 3]]);
  assert.deepEqual(clipTrackToLeg(positions, leg, 60), [[1, 1], [2, 2], [3, 3], [4, 4]]);
});

test('monthAnchors covers the window plus the prior month', () => {
  const start = Date.UTC(2026, 5, 10); // Jun 10 2026
  const end = Date.UTC(2026, 5, 20);
  const anchors = monthAnchors(start, end);
  assert.ok(anchors.includes(Date.UTC(2026, 4, 1)), 'includes May (prior month)');
  assert.ok(anchors.includes(Date.UTC(2026, 5, 1)), 'includes June');
});

test('legTail normalizes the leg aircraft tail', () => {
  assert.equal(legTail({ dispatch: { aircraft: { tailNumber: 'n-69fp' } } }), 'N69FP');
  assert.equal(legTail({ aircraft: { tailNumber: 'N100AB' } }), 'N100AB');
  assert.equal(legTail({}), '');
});

test('selectCompletedLegs keeps past, dated, de-duped legs', () => {
  const now = 5000;
  const legs = [
    { _id: { $oid: 'a' }, departure: { time: 1000, airport: 'KAAA' }, arrival: { time: 2000, airport: 'KBBB' }, dispatch: { aircraft: { tailNumber: 'N1' } } },
    { _id: { $oid: 'a' }, departure: { time: 1000, airport: 'KAAA' }, arrival: { time: 2000, airport: 'KBBB' } }, // duplicate id
    { _id: { $oid: 'b' }, departure: { time: 4000, airport: 'KCCC' }, arrival: { time: 9000, airport: 'KDDD' } }, // arrival in the future
    { _id: { $oid: 'c' }, departure: { time: 1000 }, arrival: {} }, // missing arrival time
  ];
  const out = selectCompletedLegs(legs, now);
  assert.deepEqual(out.map((l) => l.id), ['a']);
  assert.equal(out[0].tail, 'N1');
  assert.equal(out[0].from, 'KAAA');
  assert.equal(out[0].to, 'KBBB');
});

test('selectLegsToSnapshot drops already-stored legs', () => {
  const completed = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const out = selectLegsToSnapshot(completed, new Set(['b']));
  assert.deepEqual(out.map((l) => l.id), ['a', 'c']);
});
