// backend/src/slack/resolveMembers.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMembers } from './resolveMembers.js';

test('includes fixed groups, matches crew by email, dedups', () => {
  const r = resolveMembers({
    crew: [
      { oid: 'p1', name: 'Ann', email: 'ann@x.com' },
      { oid: 'p2', name: 'Bob', email: null },
    ],
    fixedGroupIds: ['UOPS1', 'UOPS1'],
    dirEmailForOid: (oid) => (oid === 'p2' ? 'bob@x.com' : null),
    slackIdForEmail: (e) => ({ 'ann@x.com': 'UANN', 'bob@x.com': 'UBOB' }[e] || null),
    overrideForEmail: () => null,
  });
  assert.deepEqual(r.inviteIds.sort(), ['UANN', 'UBOB', 'UOPS1']);
  assert.deepEqual(r.unmatched, []);
});

test('falls back to override, flags the truly unmatched', () => {
  const r = resolveMembers({
    crew: [
      { oid: 'p1', name: 'Ann', email: 'ann@x.com' },   // only in override
      { oid: 'p3', name: 'Cy', email: 'cy@x.com' },      // nowhere
    ],
    fixedGroupIds: [],
    dirEmailForOid: () => null,
    slackIdForEmail: () => null,
    overrideForEmail: (e) => (e === 'ann@x.com' ? 'UANN' : null),
  });
  assert.deepEqual(r.inviteIds, ['UANN']);
  assert.deepEqual(r.unmatched, [{ name: 'Cy', email: 'cy@x.com' }]);
});
