import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectRateCard } from './pickRateCard.js';

const owner   = { id: 'o', aircraft_tail: 'N69FP', purpose: 'owner',   label: 'N69FP' };
const charter = { id: 'c', aircraft_tail: 'N69FP', purpose: 'charter', label: 'N69FP CHARTER' };
const legacy  = { id: 'l', aircraft_tail: 'N69FP', purpose: null,      label: null };

test('selectRateCard: matches the purpose', () => {
  assert.equal(selectRateCard([owner, charter], 'charter').id, 'c');
  assert.equal(selectRateCard([owner, charter], 'owner').id, 'o');
});

test('selectRateCard: falls back to a purpose-less (default) card', () => {
  assert.equal(selectRateCard([legacy, charter], 'owner').id, 'l');
});

test('selectRateCard: falls back to the first card when nothing matches', () => {
  assert.equal(selectRateCard([charter], 'owner').id, 'c');
});

test('selectRateCard: empty list returns null', () => {
  assert.equal(selectRateCard([], 'owner'), null);
});
