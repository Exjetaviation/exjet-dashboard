import test from 'node:test';
import assert from 'node:assert/strict';
import { roleFromUser } from './role.js';

test('roleFromUser ignores self-writable user_metadata (H2)', () => {
  // An attacker can set user_metadata via supabase.auth.updateUser — it must NOT grant a role.
  const user = { app_metadata: {}, user_metadata: { app_role: 'admin' } };
  assert.equal(roleFromUser(user), 'crew');
});

test('roleFromUser reads app_metadata.app_role', () => {
  const user = { app_metadata: { app_role: 'dispatcher' }, user_metadata: {} };
  assert.equal(roleFromUser(user), 'dispatcher');
});

test('roleFromUser defaults to crew for null/empty users', () => {
  assert.equal(roleFromUser(null), 'crew');
  assert.equal(roleFromUser({}), 'crew');
  assert.equal(roleFromUser({ app_metadata: {} }), 'crew');
});
