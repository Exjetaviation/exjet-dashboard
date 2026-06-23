// backend/src/slack/channelName.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelName } from './channelName.js';

test('builds ops and accounting channel names from a trip number', () => {
  assert.equal(channelName(25104, 'ops'), 'trip-25104');
  assert.equal(channelName('25104', 'acct'), 'trip-25104-acct');
});

test('slugifies spaces/symbols and lowercases', () => {
  assert.equal(channelName('AB 12/3', 'ops'), 'trip-ab-12-3');
});

test('falls back when trip id is missing', () => {
  assert.equal(channelName(null, 'ops'), 'trip-unknown');
  assert.equal(channelName('', 'acct'), 'trip-unknown-acct');
});
