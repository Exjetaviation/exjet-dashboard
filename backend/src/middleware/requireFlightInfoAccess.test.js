import test from 'node:test';
import assert from 'node:assert/strict';
import { isCrewOnLeg } from './requireFlightInfoAccess.js';

const leg = { lf_synced_snapshot: { pilots: [{ user: { email: 'pic@x.com' }, seat: 2 }],
                                    attendants: [{ user: { email: 'fa@x.com' }, seat: 7 }] } };

test('isCrewOnLeg matches assigned pilot email (case-insensitive)', () => {
  assert.equal(isCrewOnLeg(leg, 'PIC@x.com'), true);
  assert.equal(isCrewOnLeg(leg, 'fa@x.com'), true);
  assert.equal(isCrewOnLeg(leg, 'random@x.com'), false);
});

test('isCrewOnLeg false on missing data', () => {
  assert.equal(isCrewOnLeg(null, 'pic@x.com'), false);
  assert.equal(isCrewOnLeg(leg, null), false);
});
