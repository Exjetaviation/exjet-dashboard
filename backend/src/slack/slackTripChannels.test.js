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
    async getProvisionedOids() { return new Set(seed.provisioned || []); },
    async getTripLegSnapshots() { return seed.snaps || snaps; },
    async recordChannels(row) { recorded.push(row); return true; },
    async getUpcomingProvisioned() { return seed.upcoming || []; },
    async updateInvited(oid, ids) { invitedUpdates.push({ oid, ids }); return true; },
  };
}

const dir = { async getUserIndex() { return new Map(); } };
const overrides = { async getOverrideMap() { return new Map(); } };
const config = { opsMembers: ['UOPS'], accountingMembers: ['UACCT'], managementMembers: ['UMGR'] };

test('provisions a new trip: two channels, invites, intro + unmatched note, records row', async () => {
  const slack = makeSlack();
  const store = makeStore();
  const lf = { async listDispatches() { return { dispatches: [{ _id: { $oid: 'disp1' }, tripId: 25104 }] }; } };

  const n = await provisionNewTrips({ lf, slack, store, dir, overrides, config, now: NOW });
  assert.equal(n, 1);

  // Two channels created with the right names.
  assert.deepEqual(slack.calls.created.map((c) => c.name), ['trip-25104', 'trip-25104-acct']);

  // Ops invite = fixed ops group + matched PIC; SIC (bob) unmatched.
  const opsInvite = slack.calls.invited.find((i) => i.channelId === 'C_trip-25104');
  assert.deepEqual(opsInvite.ids.sort(), ['UANN', 'UOPS']);
  const acctInvite = slack.calls.invited.find((i) => i.channelId === 'C_trip-25104-acct');
  assert.deepEqual(acctInvite.ids.sort(), ['UACCT', 'UMGR']);

  // Unmatched note posted to ops naming Bob.
  const note = slack.calls.posted.find((p) => p.channelId === 'C_trip-25104' && /Couldn't auto-add/i.test(p.text));
  assert.ok(note && /Bob/.test(note.text));

  // Recorded with both channel ids and the union of invited ids.
  assert.equal(store.recorded.length, 1);
  assert.equal(store.recorded[0].oid, 'disp1');
  assert.deepEqual(store.recorded[0].invitedSlackIds.sort(), ['UACCT', 'UANN', 'UMGR', 'UOPS']);
});

test('skips trips already provisioned', async () => {
  const slack = makeSlack();
  const store = makeStore({ provisioned: ['disp1'] });
  const lf = { async listDispatches() { return { dispatches: [{ _id: { $oid: 'disp1' }, tripId: 25104 }] }; } };
  const n = await provisionNewTrips({ lf, slack, store, dir, overrides, config, now: NOW });
  assert.equal(n, 0);
  assert.equal(slack.calls.created.length, 0);
});

test('skips quote/unbooked dispatches that have no tripId', async () => {
  const slack = makeSlack();
  const store = makeStore();
  // getDispatchList returns quotes too; an unbooked dispatch has an empty tripId.
  const lf = { async listDispatches() { return { dispatches: [{ _id: { $oid: 'dispQuote' }, tripId: '' }] }; } };
  const n = await provisionNewTrips({ lf, slack, store, dir, overrides, config, now: NOW });
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
