import { supabase } from '../supabase.js';

// True if we've already processed this gmail message (ok). Soft-fails to false if absent.
export const alreadyImported = async (messageId) => {
  const { data, error } = await supabase
    .from('fuel_price_imports').select('gmail_message_id, status').eq('gmail_message_id', messageId).maybeSingle();
  if (error) return false;
  return data?.status === 'ok';
};

// Record an import attempt (ok or error). Upsert so a retry overwrites a prior error.
export const logImport = async (row) => {
  await supabase.from('fuel_price_imports').upsert(row, { onConflict: 'gmail_message_id' });
};

// Replace a vendor's prices with a fresh batch, never leaving an empty window: insert the
// new rows tagged with import_id, then delete that vendor's rows from older imports.
export const replaceVendorPrices = async (vendor, importId, rows) => {
  if (!rows.length) return { inserted: 0 };
  const tagged = rows.map((r) => ({ ...r, import_id: importId }));
  for (let i = 0; i < tagged.length; i += 1000) {
    const { error } = await supabase.from('fuel_prices').insert(tagged.slice(i, i + 1000));
    if (error) throw error;
  }
  const { error: delErr } = await supabase
    .from('fuel_prices').delete().eq('vendor', vendor).neq('import_id', importId);
  if (delErr) throw delErr;
  return { inserted: tagged.length };
};

// Read prices for verification / the future cost project.
export const getFuelPrices = async ({ icao, vendor } = {}) => {
  let q = supabase.from('fuel_prices').select('*');
  if (icao) q = q.eq('icao', icao.trim().toUpperCase());
  if (vendor) q = q.eq('vendor', vendor);
  const { data, error } = await q.limit(500);
  if (error) return [];
  return data || [];
};

export const getImports = async () => {
  const { data, error } = await supabase
    .from('fuel_price_imports').select('*').order('imported_at', { ascending: false }).limit(50);
  if (error) return [];
  return data || [];
};
