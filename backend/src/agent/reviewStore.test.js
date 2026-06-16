// Smoke tests for reviewStore input guards. Run with: node --test
// These cover the deterministic, no-network validation paths only — the
// actual Supabase update is exercised manually against the live DB.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateReviewConversation } from './reviewStore.js';

test('updateReviewConversation rejects a missing/invalid review id', async () => {
  assert.equal(await updateReviewConversation('', []), false);
  assert.equal(await updateReviewConversation(null, []), false);
  assert.equal(await updateReviewConversation(123, []), false);
});

test('updateReviewConversation rejects a non-array conversation', async () => {
  assert.equal(await updateReviewConversation('valid-id', 'not-an-array'), false);
  assert.equal(await updateReviewConversation('valid-id', null), false);
  assert.equal(await updateReviewConversation('valid-id', { a: 1 }), false);
});
