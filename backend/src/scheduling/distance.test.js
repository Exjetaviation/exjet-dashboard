import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greatCircleNm } from './distance.js';

test('greatCircleNm matches a known pair within 1%', () => {
  // KFXE (26.197,-80.171) -> KTEB (40.850,-74.061) ≈ 925 nm
  const nm = greatCircleNm({ lat: 26.197, lng: -80.171 }, { lat: 40.850, lng: -74.061 });
  assert.ok(Math.abs(nm - 925) / 925 < 0.01, `got ${nm}`);
});

test('greatCircleNm is zero for identical points and null-safe', () => {
  assert.equal(greatCircleNm({ lat: 26, lng: -80 }, { lat: 26, lng: -80 }), 0);
  assert.equal(greatCircleNm(null, { lat: 1, lng: 1 }), null);
});
