import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasMoved, detectTakeoff, firstAirborneTime, clipTrackToLeg, deriveActualTimes, approximateActualTimes, recoverDepFromPositions, matchActiveLeg, crewActualsFromLeg, normReg, monthAnchors, legTail, selectCompletedLegs, selectLegsToSnapshot } from './adsbTrack.js';

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

const HR = 3600000;
test('firstAirborneTime returns the earliest airborne sample within the padded leg window', () => {
  const leg = { depTime: 10 * HR, arrTime: 12 * HR };
  const pts = [
    { t: 10 * HR - 5000, on_ground: true },    // pre-takeoff on the ground — ignored
    { t: 10 * HR + 60000, on_ground: false },  // first airborne
    { t: 10 * HR + 120000, on_ground: false },
  ];
  assert.equal(firstAirborneTime(pts, leg, 0), 10 * HR + 60000);
});
test('firstAirborneTime ignores on-ground and out-of-window samples, null when none airborne', () => {
  const leg = { depTime: 10 * HR, arrTime: 12 * HR };
  assert.equal(firstAirborneTime([{ t: 11 * HR, on_ground: true }], leg, 0), null);
  assert.equal(firstAirborneTime([{ t: 1 * HR, on_ground: false }], leg, 0), null); // out of window
  assert.equal(firstAirborneTime([], leg, 0), null);
  assert.equal(firstAirborneTime(null, leg, 0), null);
});
test('firstAirborneTime honors the pad around the leg window', () => {
  const leg = { depTime: 10 * HR, arrTime: 12 * HR };
  // airborne 5 min before scheduled dep is in range with a 10-min pad
  assert.equal(firstAirborneTime([{ t: 10 * HR - 5 * 60000, on_ground: false }], leg, 10 * 60000), 10 * HR - 5 * 60000);
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

const legW = { depTime: 1000, arrTime: 5000 };
test('deriveActualTimes finds ground->air departure and air->ground arrival', () => {
  const pts = [
    { t: 900, on_ground: true }, { t: 1000, on_ground: true },
    { t: 1100, on_ground: false }, // wheels-up
    { t: 3000, on_ground: false },
    { t: 4800, on_ground: true },  // wheels-down
    { t: 5000, on_ground: true },
  ];
  assert.deepEqual(deriveActualTimes(pts, legW, 500), { actualDep: 1100, actualArr: 4800 });
});

test('deriveActualTimes returns null dep when the track starts mid-air (no observed takeoff)', () => {
  const pts = [{ t: 1100, on_ground: false }, { t: 3000, on_ground: false }, { t: 4800, on_ground: true }];
  assert.deepEqual(deriveActualTimes(pts, legW, 500), { actualDep: null, actualArr: null });
});

test('deriveActualTimes returns null arr when it never lands in-window', () => {
  const pts = [{ t: 1000, on_ground: true }, { t: 1100, on_ground: false }, { t: 4900, on_ground: false }];
  assert.deepEqual(deriveActualTimes(pts, legW, 500), { actualDep: 1100, actualArr: null });
});

test('deriveActualTimes returns nulls when always on the ground', () => {
  const pts = [{ t: 1000, on_ground: true }, { t: 3000, on_ground: true }, { t: 5000, on_ground: true }];
  assert.deepEqual(deriveActualTimes(pts, legW, 500), { actualDep: null, actualArr: null });
});

test('deriveActualTimes respects the padded window (ignores out-of-window samples)', () => {
  const pts = [
    { t: 100, on_ground: true }, { t: 200, on_ground: false }, // before window+pad -> ignored
    { t: 1000, on_ground: true }, { t: 1100, on_ground: false }, { t: 4800, on_ground: true },
  ];
  assert.deepEqual(deriveActualTimes(pts, legW, 500), { actualDep: 1100, actualArr: 4800 });
});

test('approximateActualTimes uses first/last airborne sample (no transition needed)', () => {
  const pts = [
    { t: 1200, on_ground: false }, { t: 3000, on_ground: false }, { t: 4600, on_ground: false },
  ];
  assert.deepEqual(approximateActualTimes(pts, legW, 500), { actualDep: 1200, actualArr: 4600 });
});

test('approximateActualTimes returns nulls when there are no airborne samples', () => {
  const pts = [{ t: 1000, on_ground: true }, { t: 3000, on_ground: true }];
  assert.deepEqual(approximateActualTimes(pts, legW, 500), { actualDep: null, actualArr: null });
});

test('approximateActualTimes rejects sparse coverage (sliver that does not bracket the leg)', () => {
  // airborne only for 200ms of a 4000ms leg -> last-airborne is NOT the arrival.
  const pts = [{ t: 1100, on_ground: false }, { t: 1300, on_ground: false }];
  assert.deepEqual(approximateActualTimes(pts, legW, 500), { actualDep: null, actualArr: null });
});

test('recoverDepFromPositions labels a stored ground->air transition as exact', () => {
  const pts = [{ t: 900, on_ground: true }, { t: 1100, on_ground: false }, { t: 4800, on_ground: true }];
  assert.deepEqual(recoverDepFromPositions(pts, legW, 500), { dep: 1100, source: 'exact' });
});

test('recoverDepFromPositions falls back to first-airborne (approx) when the track starts mid-air', () => {
  const pts = [{ t: 1100, on_ground: false }, { t: 3000, on_ground: false }];
  assert.deepEqual(recoverDepFromPositions(pts, legW, 500), { dep: 1100, source: 'approx' });
});

test('recoverDepFromPositions returns no dep when there is no airborne history', () => {
  assert.deepEqual(recoverDepFromPositions([{ t: 1000, on_ground: true }], legW, 500), { dep: null, source: null });
  assert.deepEqual(recoverDepFromPositions([], legW, 500), { dep: null, source: null });
  assert.deepEqual(recoverDepFromPositions(null, legW, 500), { dep: null, source: null });
});

test('crewActualsFromLeg maps leg.block OUT->dep and IN->arr', () => {
  const leg = { _id: { $oid: 'L1' }, departure: { time: 1000 }, dispatch: { aircraft: { tailNumber: 'N-69FP' } }, block: { out: 950, off: 1010, on: 5000, in: 5100 } };
  const c = crewActualsFromLeg(leg);
  assert.equal(c.legId, 'L1'); assert.equal(c.actualDep, 950); assert.equal(c.actualArr, 5100);
  assert.equal(c.tail, 'N69FP'); assert.equal(c.scheduledDep, 1000);
});

test('crewActualsFromLeg returns null when no block times entered', () => {
  assert.equal(crewActualsFromLeg({ _id: { $oid: 'L1' }, departure: { time: 1000 } }), null);
  assert.equal(crewActualsFromLeg({ _id: { $oid: 'L1' }, block: {} }), null);
});

test('matchActiveLeg picks the leg whose window contains now, preferring latest departure', () => {
  const legs = [
    { legId: 'a', depTime: 1000, arrTime: 2000 },
    { legId: 'b', depTime: 5000, arrTime: 6000 },
  ];
  assert.equal(matchActiveLeg(legs, 1500, { preMs: 0, postMs: 0 })?.legId, 'a'); // mid leg a
  assert.equal(matchActiveLeg(legs, 5200, { preMs: 0, postMs: 0 })?.legId, 'b'); // mid leg b
  assert.equal(matchActiveLeg(legs, 900, { preMs: 200, postMs: 0 })?.legId, 'a'); // within pre-window
  assert.equal(matchActiveLeg(legs, 3500, { preMs: 0, postMs: 0 }), null);        // gap between legs
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
