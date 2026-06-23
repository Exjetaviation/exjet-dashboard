// backend/src/services/slack.js
//
// Minimal Slack Web API client (bot token). Form-encoded so one code path covers
// conversations.create / conversations.invite / users.lookupByEmail / chat.postMessage.
import 'dotenv/config';

const SLACK_API = 'https://slack.com/api';
const token = () => process.env.SLACK_BOT_TOKEN || null;

async function call(method, params, { token: tk = token(), fetchImpl = fetch, retries = 3 } = {}) {
  if (!tk) return { ok: false, error: 'no_token' };
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v != null) form.set(k, String(v));
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(`${SLACK_API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${tk}` },
      body: form,
    });
    if (res.status === 429 && attempt < retries) {
      const wait = Number(res.headers.get('retry-after')) || 1;
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    return res.json();
  }
}

async function findChannelByName(name, isPrivate, opts) {
  const r = await call('conversations.list',
    { types: isPrivate ? 'private_channel' : 'public_channel', limit: 1000 }, opts);
  if (!r.ok) return null;
  return (r.channels || []).find((c) => c.name === name) || null;
}

// Create a channel; if the name is taken, adopt the existing one. Returns { id, name } or null.
export async function createChannel(name, { isPrivate = true } = {}, opts = {}) {
  const r = await call('conversations.create', { name, is_private: isPrivate }, opts);
  if (r.ok) return { id: r.channel.id, name: r.channel.name };
  if (r.error === 'name_taken') {
    const found = await findChannelByName(name, isPrivate, opts);
    if (found) return { id: found.id, name: found.name };
  }
  console.warn('[slack] createChannel failed:', name, r.error);
  return null;
}

// Invite users (one call, comma-joined). Returns { invited, failed }.
export async function inviteUsers(channelId, userIds, opts = {}) {
  const ids = (userIds || []).filter(Boolean);
  if (!channelId || !ids.length) return { invited: [], failed: [] };
  const r = await call('conversations.invite', { channel: channelId, users: ids.join(',') }, opts);
  if (r.ok) return { invited: ids, failed: [] };
  // already_in_channel / cant_invite_self are non-fatal.
  if (['already_in_channel', 'cant_invite_self'].includes(r.error)) return { invited: ids, failed: [] };
  console.warn('[slack] inviteUsers failed:', channelId, r.error);
  return { invited: [], failed: ids };
}

export async function lookupByEmail(email, opts = {}) {
  if (!email) return null;
  const r = await call('users.lookupByEmail', { email }, opts);
  return r.ok ? r.user.id : null;
}

export async function postMessage(channelId, text, opts = {}) {
  if (!channelId || !text) return false;
  const r = await call('chat.postMessage', { channel: channelId, text }, opts);
  if (!r.ok) console.warn('[slack] postMessage failed:', channelId, r.error);
  return !!r.ok;
}
