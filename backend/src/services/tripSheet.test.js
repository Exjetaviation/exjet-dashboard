// backend/src/services/tripSheet.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchReleaseHtml } from './tripSheet.js';

test('fetchReleaseHtml returns HTML on success', async () => {
  const fakeGet = async () => '<html>Flight Release</html>';
  const html = await fetchReleaseHtml('abc', { get: fakeGet });
  assert.equal(html, '<html>Flight Release</html>');
});

test('fetchReleaseHtml returns null when the fetch throws (e.g. 404)', async () => {
  const fakeGet = async () => { const e = new Error('Request failed'); e.response = { status: 404 }; throw e; };
  const html = await fetchReleaseHtml('missing', { get: fakeGet });
  assert.equal(html, null);
});

test('fetchReleaseHtml returns null on empty body', async () => {
  const html = await fetchReleaseHtml('abc', { get: async () => '' });
  assert.equal(html, null);
});
