// backend/src/slack/slackTripChannels.js
//
// Orchestrates Slack channel provisioning for new LF trips and tops up crew
// membership as crew get assigned. All I/O is injected (lf, slack, store, dir,
// overrides) so this is unit-tested with fakes.
import { channelName } from './channelName.js';
import { resolveMembers } from './resolveMembers.js';
import { crewFromLegSnapshots } from './crewFromLegSnapshots.js';
import { normalizeDispatchList } from './dispatchList.js';

const emailOf = (c, userIndex) => (c.email || userIndex.get(c.oid)?.email || '').toLowerCase() || null;

async function slackIdsForEmails(slack, emails) {
  const map = new Map();
  for (const email of emails) {
    if (!email || map.has(email)) continue;
    map.set(email, await slack.lookupByEmail(email));
  }
  return map;
}

function firstDepFromSnaps(snaps) {
  const t = (snaps || []).map((s) => s?.departure?.time).filter((x) => typeof x === 'number');
  return t.length ? new Date(Math.min(...t)).toISOString() : null;
}

function routeFromSnaps(snaps) {
  const sorted = [...(snaps || [])].filter(Boolean)
    .sort((a, b) => (a?.departure?.time ?? 0) - (b?.departure?.time ?? 0));
  const icaos = [];
  for (const s of sorted) {
    if (s?.departure?.airport && !icaos.length) icaos.push(s.departure.airport);
    if (s?.arrival?.airport) icaos.push(s.arrival.airport);
  }
  return icaos.join(' → ');
}

function opsIntro(d, crew, snaps) {
  const route = routeFromSnaps(snaps);
  const crewLine = crew.length
    ? `Crew: ${crew.map((c) => `${c.role} ${c.name || c.oid}`).join(', ')}`
    : 'Crew will be added as they are assigned.';
  return `✈️ *Trip ${d.tripId || d.oid}*${route ? ` — ${route}` : ''}\nOps channel created. ${crewLine}`;
}

function acctIntro(d) {
  return `💵 *Trip ${d.tripId || d.oid}* — accounting channel created.`;
}

function unmatchedNote(unmatched) {
  const lines = unmatched.map((u) => `• ${u.name || u.email || 'unknown'}`).join('\n');
  return `⚠️ Couldn't auto-add (no Slack match):\n${lines}\nPlease add them manually.`;
}

// Resolve crew -> { inviteIds, unmatched } given current snaps and lookups.
async function resolveCrew({ snaps, fixedGroupIds, slack, dir, overrides, now }) {
  const crew = crewFromLegSnapshots(snaps);
  const userIndex = crew.length ? await dir.getUserIndex(now) : new Map();
  const overrideMap = await overrides.getOverrideMap();
  const emails = crew.map((c) => emailOf(c, userIndex)).filter(Boolean);
  const idForEmail = await slackIdsForEmails(slack, emails);
  const resolved = resolveMembers({
    crew,
    fixedGroupIds,
    dirEmailForOid: (oid) => userIndex.get(oid)?.email || null,
    slackIdForEmail: (e) => idForEmail.get(e) || null,
    overrideForEmail: (e) => overrideMap.get(e) || null,
  });
  return { crew, ...resolved };
}

async function provisionOne({ d, slack, store, dir, overrides, config, now }) {
  const ops = await slack.createChannel(channelName(d.tripId, 'ops'), { isPrivate: true });
  const acct = await slack.createChannel(channelName(d.tripId, 'acct'), { isPrivate: true });
  if (!ops || !acct) throw new Error('channel create failed');

  const snaps = await store.getTripLegSnapshots(d.oid);
  const opsRes = await resolveCrew({ snaps, fixedGroupIds: config.opsMembers, slack, dir, overrides, now });
  const acctRes = resolveMembers({
    crew: [],
    fixedGroupIds: [...config.accountingMembers, ...config.managementMembers],
  });

  await slack.inviteUsers(ops.id, opsRes.inviteIds);
  await slack.inviteUsers(acct.id, acctRes.inviteIds);
  await slack.postMessage(ops.id, opsIntro(d, opsRes.crew, snaps));
  await slack.postMessage(acct.id, acctIntro(d));
  if (opsRes.unmatched.length) await slack.postMessage(ops.id, unmatchedNote(opsRes.unmatched));

  await store.recordChannels({
    oid: d.oid,
    tripId: d.tripId,
    opsChannelId: ops.id,
    acctChannelId: acct.id,
    invitedSlackIds: [...new Set([...opsRes.inviteIds, ...acctRes.inviteIds])],
    firstDepAt: firstDepFromSnaps(snaps),
    status: 'ok',
  });
}

// Detect new dispatches and provision their channels. Returns the count provisioned.
export async function provisionNewTrips({ lf, slack, store, dir, overrides, config, now }) {
  const dispatches = normalizeDispatchList(await lf.listDispatches());
  const provisioned = await store.getProvisionedOids();
  // Only real booked trips get channels. getDispatchList also returns quote/unbooked
  // dispatches, which carry an empty tripId — skip them (they provision once booked
  // and assigned a trip number, at which point they're still "not yet provisioned").
  const fresh = dispatches.filter((d) => d.tripId && !provisioned.has(d.oid));
  for (const d of fresh) {
    try { await provisionOne({ d, slack, store, dir, overrides, config, now }); }
    catch (e) { console.warn('[slack-channels] provision failed', d.oid, e?.message || e); }
  }
  return fresh.length;
}

// Add newly-assigned crew to already-provisioned upcoming trips (invite-only).
export async function topUpMembership({ slack, store, dir, overrides, config, now }) {
  const nowIso = new Date(now).toISOString();
  const rows = await store.getUpcomingProvisioned(nowIso);
  for (const row of rows) {
    try {
      const snaps = await store.getTripLegSnapshots(row.lf_dispatch_oid);
      const { inviteIds } = await resolveCrew({ snaps, fixedGroupIds: [], slack, dir, overrides, now });
      const already = new Set(row.invited_slack_ids || []);
      const toAdd = inviteIds.filter((id) => !already.has(id));
      if (!toAdd.length) continue;
      await slack.inviteUsers(row.ops_channel_id, toAdd);
      await store.updateInvited(row.lf_dispatch_oid, [...already, ...toAdd]);
    } catch (e) { console.warn('[slack-channels] topup failed', row.lf_dispatch_oid, e?.message || e); }
  }
}
