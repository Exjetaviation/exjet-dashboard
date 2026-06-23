// backend/src/services/slackOverrideStore.js
// Soft-failing read of slack_user_overrides (migration 018): lf_email -> slack_user_id.
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

let _client = null;
function getClient() {
  if (_client !== null) return _client || null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { _client = false; return null; }
  try { _client = createClient(url, key); return _client; }
  catch (e) { console.warn('[slackOverrideStore] init failed (soft):', e.message); _client = false; return null; }
}

// Map(lowercased lf_email -> slack_user_id). Empty on soft-fail.
export async function getOverrideMap() {
  const client = getClient();
  if (!client) return new Map();
  try {
    const { data, error } = await client.from('slack_user_overrides').select('lf_email, slack_user_id');
    if (error) { console.warn('[slackOverrideStore] getOverrideMap (soft):', error.message); return new Map(); }
    return new Map((data || []).map((r) => [String(r.lf_email || '').toLowerCase(), r.slack_user_id]));
  } catch (e) { console.warn('[slackOverrideStore] getOverrideMap (soft):', e?.message || e); return new Map(); }
}
