// backend/src/slack/slackTripChannels.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provisionNewTrips, topUpMembership } from './slackTripChannels.js';

const NOW = Date.parse('2026-06-23T12:00:00Z');

function makeSlack() {
  const calls = { created: [], invited: [], posted: [] };
  const emailToId = { 'ann@x.com': 'UANN' }; // SIC bob@x.com intentionally unmatched
  return {
    calls,
    async createChannel(name) { const id = `C_${name}`; calls.created.push({ name, id }); return { id, name }; },
    async inviteUsers(channelId, ids) { calls.invited.push({ channelId, ids }); return { invited: ids, failed: [] }; },
    async lookupByEmail(email) { return emailToId[email] || null; },
    async postMessage(channelId, text) { calls.posted.push({ channelId, text }); return true; },
  };
}

const snaps = [{
  departure: { airport: 'KFXE', time: 1765207800000 }, arrival: { airport: 'TJSJ', time: 1765222200000 },
  pilots: [
    { seat: 2, user: { _id: { $oid: 'pic1' }, firstName: 'Ann', email: 'ann@x.com' } },
    { seat: 3, user: { _id: { $oid: 'sic1' }, firstName: 'Bob', email: 'bob@x.com' } },
  ],
}];

function makeStore(seed = {}) {
  const recorded = [];
  const invitedUpdates = [];
  return {
    recorded, invitedUpdates,
    async getCandidateTrips() { return seed.candidates || []; },
    async getProvisionedOids() { return new Set(seed.provisioned || []); },
    async getProvisionedTripIds() { return new Set((seed.provisionedTripIds || []).map(String)); },
    async getTripLegSnapshots() { return seed.snaps || snaps; },
    async recordChannels(row) { recorded.push(row); return true; },
    async getUpcomingProvisioned() { return seed.upcoming || []; },
    async updateInvited(oid, ids) { invitedUpdates.push({ oid, ids }); return true; },
  };
}

const dir = { async getUserIndex() { return new Map(); } };
const overrides = { async getOverrideMap() { return new Map(); } };
const config = { opsMembers: ['UOPS'], accountingMembers: ['UACCT'], managementMembers: ['UMGR'], since: '2026-06-23T00:00:00Z' };

test('provisions a new trip: one channel, invites (ops+mgmt+crew), intro + unmatched note, records row', async () => {
  const slack = makeSlack();
  const store = makeStore({ candidates: [{ oid: 'disp1', tripId: 25104 }] });

  const n = await provisionNewTrips({ slack, store, dir, overrides, config, now: NOW });
  assert.equal(n, 1);

  // Only the trip channel is created — no separate accounting channel.
  assert.deepEqual(slack.calls.created.map((c) => c.name), ['trip-25104']);

  // Invite = fixed ops group + management + matched PIC; accounting (UACCT) dropped; SIC (bob) unmatched.
  const opsInvite = slack.calls.invited.find((i) => i.channelId === 'C_trip-25104');
  assert.deepEqual(opsInvite.ids.sort(), ['UANN', 'UMGR', 'UOPS']);
  // No acct channel, no acct invite.
  assert.ok(!slack.calls.created.some((c) => /-acct$/.test(c.name)));
  assert.ok(!slack.calls.invited.some((i) => i.ids.includes('UACCT')));

  // Unmatched note posted to the trip channel naming Bob.
  const note = slack.calls.posted.find((p) => p.channelId === 'C_trip-25104' && /Couldn't auto-add/i.test(p.text));
  assert.ok(note && /Bob/.test(note.text));

  // Recorded with the trip channel id, null acct id, and the invited ids.
  assert.equal(store.recorded.length, 1);
  assert.equal(store.recorded[0].oid, 'disp1');
  assert.equal(store.recorded[0].acctChannelId, null);
  assert.deepEqual(store.recorded[0].invitedSlackIds.sort(), ['UANN', 'UMGR', 'UOPS']);
});

test('skips trip numbers already provisioned', async () => {
  const slack = makeSlack();
  const store = makeStore({ provisionedTripIds: ['25104'], candidates: [{ oid: 'disp1', tripId: 25104 }] });
  const n = await provisionNewTrips({ slack, store, dir, overrides, config, now: NOW });
  assert.equal(n, 0);
  assert.equal(slack.calls.created.length, 0);
});

test('dedupes multiple dispatch oids sharing one trip number into one channel set', async () => {
  const slack = makeSlack();
  // Same trip number 25107 from two dispatch oids (e.g. delete+recreate).
  const store = makeStore({ candidates: [{ oid: 'old', tripId: 25107 }, { oid: 'new', tripId: 25107 }] });
  const n = await provisionNewTrips({ slack, store, dir, overrides, config, now: NOW });
  assert.equal(n, 1);
  assert.deepEqual(slack.calls.created.map((c) => c.name), ['trip-25107']);
  assert.equal(store.recorded.length, 1);
});

test('skips mirror rows without a trip number (empty tripId)', async () => {
  const slack = makeSlack();
  // A mirror row without a trip number is not a booked trip — skip it.
  const store = makeStore({ candidates: [{ oid: 'dispQuote', tripId: '' }] });
  const n = await provisionNewTrips({ slack, store, dir, overrides, config, now: NOW });
  assert.equal(n, 0);
  assert.equal(slack.calls.created.length, 0);
  assert.equal(store.recorded.length, 0);
});

test('top-up invites newly-assigned crew not already invited', async () => {
  const slack = makeSlack();
  const store = makeStore({
    upcoming: [{ lf_dispatch_oid: 'disp1', ops_channel_id: 'C_trip-25104', invited_slack_ids: ['UOPS'], first_dep_at: null }],
  });
  await topUpMembership({ slack, store, dir, overrides, config, now: NOW });
  const inv = slack.calls.invited.find((i) => i.channelId === 'C_trip-25104');
  assert.deepEqual(inv.ids, ['UANN']);                 // PIC added; UOPS already there; Bob unmatched
  assert.deepEqual(store.invitedUpdates[0].ids.sort(), ['UANN', 'UOPS']);
});
