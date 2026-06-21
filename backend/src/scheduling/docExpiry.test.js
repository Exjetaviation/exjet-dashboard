// backend/src/scheduling/docExpiry.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentAlerts } from './docExpiry.js';

const NOW = Date.parse('2026-06-20');
const day = (s) => Date.parse(s);

test('expired passport is red even with no trips', () => {
  const a = documentAlerts({ passport_expiry: '2025-01-01' }, [], NOW);
  assert.equal(a.length, 1);
  assert.equal(a[0].key, 'passport');
  assert.equal(a[0].severity, 'red');
  assert.equal(a[0].reason, 'expired');
});

test('passport expiring before the next booked trip is red', () => {
  const a = documentAlerts({ passport_expiry: '2026-07-01' }, [day('2026-08-01')], NOW);
  assert.equal(a[0].severity, 'red');
  assert.equal(a[0].reason, 'expires-before-trip');
});

test('passport valid but inside the 6-month window is amber', () => {
  // trip 2026-07-01, passport expires 2026-10-01 -> within 6 months after the trip
  const a = documentAlerts({ passport_expiry: '2026-10-01' }, [day('2026-07-01')], NOW);
  assert.equal(a[0].severity, 'amber');
  assert.equal(a[0].reason, 'six-month-rule');
});

test('passport valid well past the window produces no alert', () => {
  assert.deepEqual(documentAlerts({ passport_expiry: '2030-01-01' }, [day('2026-07-01')], NOW), []);
});

test('null / missing expiry dates are ignored', () => {
  assert.deepEqual(documentAlerts({ passport_expiry: null, visa_expiry: '' }, [day('2026-07-01')], NOW), []);
});

test('checks passport, visa and green card independently', () => {
  const a = documentAlerts({ passport_expiry: '2025-01-01', visa_expiry: '2030-01-01' }, [], NOW);
  assert.deepEqual(a.map((x) => x.key), ['passport']);
});

test('malformed date string is ignored', () => {
  assert.deepEqual(documentAlerts({ passport_expiry: 'garbage' }, [], NOW), []);
});
