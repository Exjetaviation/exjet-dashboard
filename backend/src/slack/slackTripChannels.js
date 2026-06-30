// backend/src/slack/slackTripChannels.js
//
// Orchestrates Slack channel provisioning for new LF trips and tops up crew
// membership as crew get assigned. All I/O is injected (slack, store, dir,
// overrides) so this is unit-tested with fakes. New trips are detected from the
// scheduling mirror (store.getCandidateTrips), which carries real trip numbers.
import { channelName } from './channelName.js';
import { resolveMembers } from './resolveMembers.js';
import { crewFromLegSnapshots } from './crewFromLegSnapshots.js';

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
  // One channel per trip — the trip/ops channel. Accounting channels were retired;
  // management members are folded into this channel, accounting members are dropped.
  const ops = await slack.createChannel(channelName(d.tripId, 'ops'), { isPrivate: true });
  if (!ops) throw new Error('channel create failed');

  const snaps = await store.getTripLegSnapshots(d.oid);
  const opsRes = await resolveCrew({
    snaps,
    fixedGroupIds: [...config.opsMembers, ...config.managementMembers],
    slack, dir, overrides, now,
  });

  await slack.inviteUsers(ops.id, opsRes.inviteIds);
  await slack.postMessage(ops.id, opsIntro(d, opsRes.crew, snaps));
  if (opsRes.unmatched.length) await slack.postMessage(ops.id, unmatchedNote(opsRes.unmatched));

  await store.recordChannels({
    oid: d.oid,
    tripId: d.tripId,
    opsChannelId: ops.id,
    acctChannelId: null,
    invitedSlackIds: opsRes.inviteIds,
    firstDepAt: firstDepFromSnaps(snaps),
    status: 'ok',
  });
}

// Detect new booked trips (from the mirror) and provision their channels. Returns
// the count provisioned.
export async function provisionNewTrips({ slack, store, dir, overrides, config, now }) {
  const candidates = await store.getCandidateTrips(config.since);
  const provisionedTripIds = await store.getProvisionedTripIds();
  // One channel set per trip NUMBER: a number can map to several dispatch oids
  // (e.g. a deleted+recreated trip leaves a stale mirror row). Dedupe by tripId and
  // skip numbers already provisioned.
  const seen = new Set();
  const fresh = [];
  for (const d of candidates) {
    const t = d.tripId ? String(d.tripId) : null;
    if (!t || seen.has(t) || provisionedTripIds.has(t)) continue;
    seen.add(t);
    fresh.push(d);
  }
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
