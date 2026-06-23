// backend/src/services/slackChannelStore.js
// Soft-failing persistence for trip_slack_channels (migration 018). No-ops if
// Supabase isn't configured or the table is absent. Pattern: legActualsStore.js.
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

let _client = null;
function getClient() {
  if (_client !== null) return _client || null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { _client = false; return null; }
  try { _client = createClient(url, key); return _client; }
  catch (e) { console.warn('[slackChannelStore] init failed (soft):', e.message); _client = false; return null; }
}

// Set of LF dispatch oids that already have channels.
export async function getProvisionedOids() {
  const client = getClient();
  if (!client) return new Set();
  try {
    const { data, error } = await client.from('trip_slack_channels').select('lf_dispatch_oid');
    if (error) { console.warn('[slackChannelStore] getProvisionedOids (soft):', error.message); return new Set(); }
    return new Set((data || []).map((r) => r.lf_dispatch_oid));
  } catch (e) { console.warn('[slackChannelStore] getProvisionedOids (soft):', e?.message || e); return new Set(); }
}

// Set of trip NUMBERS that already have channels — channels are one-per-trip-number
// (a number can map to several dispatch oids, e.g. after delete+recreate).
export async function getProvisionedTripIds() {
  const client = getClient();
  if (!client) return new Set();
  try {
    const { data, error } = await client.from('trip_slack_channels').select('trip_id');
    if (error) { console.warn('[slackChannelStore] getProvisionedTripIds (soft):', error.message); return new Set(); }
    return new Set((data || []).map((r) => r.trip_id).filter(Boolean).map(String));
  } catch (e) { console.warn('[slackChannelStore] getProvisionedTripIds (soft):', e?.message || e); return new Set(); }
}

// Insert/replace a provisioned-trip row.
export async function recordChannels({ oid, tripId, opsChannelId, acctChannelId, invitedSlackIds, firstDepAt, status }) {
  const client = getClient();
  if (!client || !oid) return false;
  const row = {
    lf_dispatch_oid: oid,
    trip_id: tripId ?? null,
    ops_channel_id: opsChannelId ?? null,
    acct_channel_id: acctChannelId ?? null,
    invited_slack_ids: invitedSlackIds || [],
    first_dep_at: firstDepAt ?? null,
    status: status || 'ok',
    created_at: new Date().toISOString(),
  };
  try {
    const { error } = await client.from('trip_slack_channels').upsert(row, { onConflict: 'lf_dispatch_oid' });
    if (error) { console.warn('[slackChannelStore] recordChannels (soft):', error.message); return false; }
    return true;
  } catch (e) { console.warn('[slackChannelStore] recordChannels (soft):', e?.message || e); return false; }
}

// Provisioned trips still worth topping up: no known departure, or it's in the future.
export async function getUpcomingProvisioned(nowIso) {
  const client = getClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from('trip_slack_channels')
      .select('lf_dispatch_oid, ops_channel_id, invited_slack_ids, first_dep_at')
      .or(`first_dep_at.is.null,first_dep_at.gte.${nowIso}`);
    if (error) { console.warn('[slackChannelStore] getUpcomingProvisioned (soft):', error.message); return []; }
    return data || [];
  } catch (e) { console.warn('[slackChannelStore] getUpcomingProvisioned (soft):', e?.message || e); return []; }
}

// Replace the invited-ids list for a trip (top-up dedup).
export async function updateInvited(oid, invitedSlackIds) {
  const client = getClient();
  if (!client || !oid) return false;
  try {
    const { error } = await client.from('trip_slack_channels')
      .update({ invited_slack_ids: invitedSlackIds || [] })
      .eq('lf_dispatch_oid', oid);
    if (error) { console.warn('[slackChannelStore] updateInvited (soft):', error.message); return false; }
    return true;
  } catch (e) { console.warn('[slackChannelStore] updateInvited (soft):', e?.message || e); return false; }
}
