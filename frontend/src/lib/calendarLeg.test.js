import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATE_COLORS, STATUS, arrShown, legStateColor, floorDay, nmBetween, landedAtDestination } from './calendarLeg.js';

const H = 3600000;

// ---------------------------------------------------------------------------
// arrShown
// ---------------------------------------------------------------------------
test('arrShown: arr null → false', () => {
  assert.equal(arrShown(1000, null), false);
  assert.equal(arrShown(null, null), false);
});

test('arrShown: arr <= dep → false (corrupt)', () => {
  assert.equal(arrShown(2000, 1000), false);
  assert.equal(arrShown(1000, 1000), false);
});

test('arrShown: arr > dep → true', () => {
  assert.equal(arrShown(1000, 2000), true);
});

test('arrShown: dep null + arr present → true (ADS-B missed wheels-up)', () => {
  assert.equal(arrShown(null, 5000), true);
});

// ---------------------------------------------------------------------------
// floorDay
// ---------------------------------------------------------------------------
const someTs = new Date(2026, 5, 28, 14, 30, 0).getTime(); // Jun 28 2026 14:30 local

test('floorDay: returns local midnight (result <= ts)', () => {
  const mid = floorDay(someTs);
  assert.ok(mid <= someTs, 'midnight must be <= source ts');
  const d = new Date(mid);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getSeconds(), 0);
  assert.equal(d.getMilliseconds(), 0);
});

test('floorDay: flooring twice is stable (idempotent)', () => {
  const mid = floorDay(someTs);
  assert.equal(floorDay(mid), mid);
});

test('floorDay: same calendar-day inputs floor to equal timestamps', () => {
  const morning = new Date(2026, 5, 28, 7, 0, 0).getTime();
  const evening = new Date(2026, 5, 28, 23, 59, 59).getTime();
  assert.equal(floorDay(morning), floorDay(evening));
});

test('floorDay: adjacent days floor to different timestamps', () => {
  const day1 = new Date(2026, 5, 28, 23, 59, 59).getTime();
  const day2 = new Date(2026, 5, 29, 0, 0, 0).getTime();
  assert.notEqual(floorDay(day1), floorDay(day2));
});

// ---------------------------------------------------------------------------
// legStateColor
// ---------------------------------------------------------------------------
const now = new Date(2026, 5, 28, 12, 0, 0).getTime();
const futureDep = now + 5 * H;
const futureArr = now + 7 * H;
const pastDep   = now - 10 * H;
const pastArr   = now - 2 * H;

test('legStateColor: future leg (no actuals, dep > now) → future color', () => {
  const leg = { departure: { time: futureDep }, arrival: { time: futureArr } };
  assert.equal(legStateColor(leg, false, {}, now), STATE_COLORS.future);
});

test('legStateColor: isAirborne true → inflight color (regardless of actuals)', () => {
  const leg = { departure: { time: pastDep }, arrival: { time: futureArr } };
  assert.equal(legStateColor(leg, true, {}, now), STATE_COLORS.inflight);
});

test('legStateColor: coherent actualArr in past → completed color', () => {
  const leg = { departure: { time: pastDep }, arrival: { time: pastArr } };
  const act = { actualDep: pastDep + H, actualArr: pastArr - 30 * 60000 };
  assert.equal(legStateColor(leg, false, act, now), STATE_COLORS.completed);
});

test('legStateColor: airborne isAirborne=true overrides completed actuals', () => {
  const leg = { departure: { time: pastDep }, arrival: { time: pastArr } };
  const act = { actualDep: pastDep + H, actualArr: pastArr + H };
  // Even though actuals look complete, isAirborne=true wins
  assert.equal(legStateColor(leg, true, act, now), STATE_COLORS.inflight);
});

test('legStateColor: mid-flight by schedule clock (no actuals) → inflight color', () => {
  const depRecent = now - 1 * H;
  const arrFuture = now + 1 * H;
  const leg = { departure: { time: depRecent }, arrival: { time: arrFuture } };
  assert.equal(legStateColor(leg, false, {}, now), STATE_COLORS.inflight);
});

test('legStateColor: schedule has passed with no actuals → completed color', () => {
  const leg = { departure: { time: pastDep }, arrival: { time: pastArr } };
  assert.equal(legStateColor(leg, false, {}, now), STATE_COLORS.completed);
});

// Confirm STATE_COLORS are the expected hex values (so agenda uses the same palette)
test('STATE_COLORS has expected values', () => {
  assert.equal(STATE_COLORS.completed, '#4f8ef7');
  assert.equal(STATE_COLORS.inflight,  '#22c55e');
  assert.equal(STATE_COLORS.future,    '#64748b');
});

// STATUS is exported and has correct labels
test('STATUS labels match Calendar expectations', () => {
  assert.equal(STATUS[0].label, 'Scheduled');
  assert.equal(STATUS[3].label, 'Completed');
});

// ---------------------------------------------------------------------------
// nmBetween — great-circle distance in nautical miles
// ---------------------------------------------------------------------------
test('nmBetween: 1° of latitude ≈ 60 nm', () => {
  const d = nmBetween(0, 0, 1, 0);
  assert.ok(Math.abs(d - 60) < 0.5, `expected ~60, got ${d}`);
});

test('nmBetween: same point → 0', () => {
  assert.equal(nmBetween(29.64, -95.27, 29.64, -95.27), 0);
});

test('nmBetween: missing coord → null', () => {
  assert.equal(nmBetween(null, 0, 1, 0), null);
  assert.equal(nmBetween(0, 0, 1, undefined), null);
});

// ---------------------------------------------------------------------------
// landedAtDestination — on-ground (live OR last-known) near the scheduled arrival
// ---------------------------------------------------------------------------
const KHOU = { lat: 29.6454, lng: -95.2789 }; // Houston Hobby

test('landedAtDestination: on the ground at the destination → true (even when stale)', () => {
  const la = { lat: 29.646, lon: -95.279, onGround: true, stale: true };
  assert.equal(landedAtDestination(la, KHOU), true);
});

test('landedAtDestination: live on-ground at destination → true', () => {
  const la = { lat: 29.6454, lon: -95.2789, onGround: true, stale: false };
  assert.equal(landedAtDestination(la, KHOU), true);
});

test('landedAtDestination: LIVE airborne fix → false (still flying)', () => {
  const la = { lat: 29.6454, lon: -95.2789, onGround: false, stale: false };
  assert.equal(landedAtDestination(la, KHOU), false);
});

test('landedAtDestination: STALE airborne fix ~2nm out on final → true (lost on approach = landed)', () => {
  // The real KHOU case: last ADS-B fix airborne ~1.8nm from the field, then coverage dropped.
  const la = { lat: 29.662388, lon: -95.259758, onGround: false, stale: true };
  assert.equal(landedAtDestination(la, KHOU), true);
});

test('landedAtDestination: STALE airborne fix far from destination → false (lost mid-route)', () => {
  const la = { lat: 30.5, lon: -95.0, onGround: false, stale: true }; // ~55nm away
  assert.equal(landedAtDestination(la, KHOU), false);
});

test('landedAtDestination: on ground but far from destination (~12nm) → false', () => {
  const la = { lat: 29.85, lon: -95.27, onGround: true }; // ~12 nm north
  assert.equal(landedAtDestination(la, KHOU), false);
});

test('landedAtDestination: missing fix or arrival coords → false', () => {
  assert.equal(landedAtDestination(null, KHOU), false);
  assert.equal(landedAtDestination({ lat: 29.6454, lon: -95.2789, onGround: true }, null), false);
  assert.equal(landedAtDestination({ onGround: true }, KHOU), false);
});
