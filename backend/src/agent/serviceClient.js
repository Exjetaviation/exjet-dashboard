// Shared lazily-built Supabase service-role client for the read tools that
// query our own tables (manual search, NTSB profiles). Cached after first use.
// Throws if the service env isn't configured — callers that must fail soft
// (e.g. reviewStore.js persistence) keep their own null-returning client.

import { createClient } from '@supabase/supabase-js';

let _client = null;

export function getServiceClient(forWhat = 'this operation') {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(`SUPABASE_URL / SUPABASE_SERVICE_KEY must be set for ${forWhat}`);
  }
  _client = createClient(url, key);
  return _client;
}
