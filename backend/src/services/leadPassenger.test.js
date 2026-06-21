// backend/src/services/leadPassenger.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leadUserId } from './leadPassenger.js';

test('leadUserId returns the unique lowest-seat passenger', () => {
  const pax = [
    { user: { _id: 'a' }, seat: 9 },
    { user: { _id: 'b' }, seat: 8 }, // lead
    { user: { _id: 'c' }, seat: 9 },
  ];
  assert.equal(leadUserId(pax), 'b');
});

test('leadUserId resolves $oid-wrapped ids', () => {
  const pax = [{ user: { _id: { $oid: 'x' } }, seat: 8 }, { user: { _id: { $oid: 'y' } }, seat: 9 }];
  assert.equal(leadUserId(pax), 'x');
});

test('leadUserId returns null when the lowest seat is tied (no clear lead)', () => {
  const pax = [{ user: { _id: 'a' }, seat: 8 }, { user: { _id: 'b' }, seat: 8 }, { user: { _id: 'c' }, seat: 9 }];
  assert.equal(leadUserId(pax), null);
});

test('leadUserId returns null when all seats are equal (toggle off)', () => {
  assert.equal(leadUserId([{ user: { _id: 'a' }, seat: 9 }, { user: { _id: 'b' }, seat: 9 }]), null);
});

test('leadUserId returns null for empty / unseated / missing input', () => {
  assert.equal(leadUserId([]), null);
  assert.equal(leadUserId(null), null);
  assert.equal(leadUserId([{ user: { _id: 'a' } }]), null); // no seat
});
