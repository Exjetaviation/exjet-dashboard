// backend/src/services/docMap.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapScript } from './docMap.js';

test('mapScript embeds segments and the plane for legs with coords', () => {
  const vm = { legs: [{ fromLatLng: [28.4, -81.3], toLatLng: [25.7, -80.3] }] };
  const s = mapScript(vm);
  assert.match(s, /const segs = \[\[\[28\.4,-81\.3\],\[25\.7,-80\.3\]\]\]/);
  assert.match(s, /qplane/);
  assert.match(s, /__mapReady/);
});

test('mapScript handles no coords (empty segs)', () => {
  const s = mapScript({ legs: [{ from: 'KFXE', to: 'KMIA' }] });
  assert.match(s, /const segs = \[\]/);
});
