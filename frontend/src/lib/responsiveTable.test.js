import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardFields } from './responsiveTable.js';

test('uses the column marked role:title as the card title', () => {
  const cols = [
    { key: 'date', label: 'Date' },
    { key: 'route', label: 'Route', role: 'title' },
    { key: 'pax', label: 'Pax' },
  ];
  const { title, meta } = cardFields(cols);
  assert.equal(title.key, 'route');
  assert.deepEqual(meta.map((c) => c.key), ['date', 'pax']);
});

test('falls back to the first column when no title role is set', () => {
  const cols = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }];
  const { title, meta } = cardFields(cols);
  assert.equal(title.key, 'a');
  assert.deepEqual(meta.map((c) => c.key), ['b']);
});

test('omits columns marked role:hide from the card meta', () => {
  const cols = [
    { key: 'a', label: 'A', role: 'title' },
    { key: 'b', label: 'B' },
    { key: 'c', label: 'C', role: 'hide' },
  ];
  const { meta } = cardFields(cols);
  assert.deepEqual(meta.map((c) => c.key), ['b']);
});
