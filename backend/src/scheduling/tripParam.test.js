import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tripParamColumn } from './tripParam.js';

test('tripParamColumn: a uuid resolves to the id column', () => {
  assert.equal(tripParamColumn('3f1a2b3c-4d5e-6f70-8190-a1b2c3d4e5f6'), 'id');
});

test('tripParamColumn: a 24-hex LevelFlight oid resolves to lf_oid', () => {
  assert.equal(tripParamColumn('652f1a2b3c4d5e6f70819011'), 'lf_oid');
});

test('tripParamColumn: a bare number resolves to trip_number', () => {
  assert.equal(tripParamColumn('26000'), 'trip_number');
});

test('tripParamColumn: empty/garbage falls back to trip_number', () => {
  assert.equal(tripParamColumn(''), 'trip_number');
  assert.equal(tripParamColumn('Trip-26000'), 'trip_number');
});
