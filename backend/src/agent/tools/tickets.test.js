// Regression tests for SMS ticket open/closed classification.
// LevelFlight closes tickets with a top-level `closedOn` timestamp, never a
// `logs.closed` entry — so closed tickets that ended at the `followedUp` (or
// `reviewed`) stage must NOT be reported as open. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ticketLifecycle, normalizeTicket } from './index.js';

const followedUpLogs = { opened: {}, processed: {}, analyzed: {}, corrected: {}, followedUp: {} };

test('a ticket with closedOn is closed even when it ended at followedUp', () => {
  const lc = ticketLifecycle(followedUpLogs, 1744571109000);
  assert.equal(lc.status, 'closed');
  assert.equal(lc.stage, 'closed');
});

test('a ticket with no closedOn and no closed log is open at its last stage', () => {
  const lc = ticketLifecycle(followedUpLogs, null);
  assert.equal(lc.status, 'open');
  assert.equal(lc.stage, 'followedUp');
});

test('the reviewed stage is recognized as the most-advanced stage', () => {
  const lc = ticketLifecycle({ opened: {}, processed: {}, analyzed: {}, corrected: {}, followedUp: {}, reviewed: {} }, null);
  assert.equal(lc.stage, 'reviewed');
  assert.equal(lc.status, 'open');
});

test('legacy logs.closed still counts as closed', () => {
  assert.equal(ticketLifecycle({ opened: {}, closed: {} }, null).status, 'closed');
});

test('no logs and no closedOn is unknown', () => {
  assert.equal(ticketLifecycle(null, null).status, 'unknown');
});

test('normalizeTicket reads closedOn from the ticket (real N69FP shape)', () => {
  // Ticket 13: closed on LevelFlight (closedOn set), last log stage followedUp.
  const closed = normalizeTicket({ _id: { $oid: 'a' }, aircraft: { tailNumber: 'N69FP' }, logs: followedUpLogs, closedOn: 1744571109000 });
  assert.equal(closed.lifecycle.status, 'closed');
  // Same ticket but not yet closed → open.
  const open = normalizeTicket({ _id: { $oid: 'b' }, aircraft: { tailNumber: 'N69FP' }, logs: followedUpLogs });
  assert.equal(open.lifecycle.status, 'open');
});
