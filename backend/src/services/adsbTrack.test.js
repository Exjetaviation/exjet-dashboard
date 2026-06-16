import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasMoved, detectTakeoff, clipTrackToLeg } from './adsbTrack.js';

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
