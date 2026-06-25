// backend/src/fleet/aircraftStore.js
// Soft-fail store for aircraft profiles. Pass the supabase client in (null => no-op).

export async function listAircraft(supabase) {
  if (!supabase) return [];
  const { data, error } = await supabase.from('aircraft').select('*').order('tail', { ascending: true });
  if (error) { console.warn('[fleet] listAircraft soft-fail:', error.message); return []; }
  return data || [];
}

export async function getAircraft(supabase, idOrTail) {
  if (!supabase) return null;
  const col = /^[0-9a-f]{8}-/i.test(idOrTail) ? 'id' : 'tail';
  const val = col === 'tail' ? String(idOrTail).trim().toUpperCase() : idOrTail;
  const { data, error } = await supabase.from('aircraft').select('*').eq(col, val).maybeSingle();
  if (error) { console.warn('[fleet] getAircraft soft-fail:', error.message); return null; }
  return data || null;
}

export async function upsertAircraftByTail(supabase, row) {
  if (!supabase) return null;
  const payload = { ...row, tail: (row.tail || '').trim().toUpperCase(), updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from('aircraft')
    .upsert(payload, { onConflict: 'tail' }).select().single();
  if (error) { console.warn('[fleet] upsertAircraftByTail soft-fail:', error.message); return null; }
  return data;
}

export async function patchAircraft(supabase, id, patch) {
  if (!supabase) return null;
  const payload = { ...patch, locally_modified: true, updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from('aircraft').update(payload).eq('id', id).select().single();
  if (error) { console.warn('[fleet] patchAircraft soft-fail:', error.message); return null; }
  return data;
}
