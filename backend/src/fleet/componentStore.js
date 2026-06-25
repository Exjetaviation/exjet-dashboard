// backend/src/fleet/componentStore.js
// Soft-fail component + ledger store. Pure totals helper is unit-tested.

export function totalsFromEntries(component, entries) {
  const baseH = Number(component?.baseline_hours || 0);
  const baseC = Number(component?.baseline_cycles || 0);
  let h = baseH, c = baseC;
  for (const e of entries || []) { h += Number(e.hours_delta || 0); c += Number(e.cycles_delta || 0); }
  return { total_hours: Math.round(h * 100) / 100, total_cycles: Math.round(c) };
}

export async function listComponents(supabase, aircraftId = null) {
  if (!supabase) return [];
  let q = supabase.from('aircraft_components').select('*');
  if (aircraftId) q = q.eq('aircraft_id', aircraftId);
  const { data, error } = await q;
  if (error) { console.warn('[fleet] listComponents soft-fail:', error.message); return []; }
  return data || [];
}

export async function upsertComponent(supabase, row) {
  if (!supabase) return null;
  const onConflict = row.lf_component_oid ? 'lf_component_oid' : undefined;
  const payload = { ...row, updated_at: new Date().toISOString() };
  const q = supabase.from('aircraft_components');
  const { data, error } = onConflict
    ? await q.upsert(payload, { onConflict }).select().single()
    : await q.insert(payload).select().single();
  if (error) { console.warn('[fleet] upsertComponent soft-fail:', error.message); return null; }
  return data;
}

export async function recomputeTotals(supabase, componentId) {
  if (!supabase) return null;
  const { data: comp } = await supabase.from('aircraft_components').select('*').eq('id', componentId).maybeSingle();
  if (!comp) return null;
  const { data: entries } = await supabase.from('component_time_entries').select('hours_delta,cycles_delta').eq('component_id', componentId);
  const totals = totalsFromEntries(comp, entries || []);
  const { data, error } = await supabase.from('aircraft_components')
    .update({ ...totals, updated_at: new Date().toISOString() }).eq('id', componentId).select().single();
  if (error) { console.warn('[fleet] recomputeTotals soft-fail:', error.message); return null; }
  return data;
}

// Idempotent: upsert one entry per (component_id, leg_id); then recompute.
export async function applyLedgerEntry(supabase, entry) {
  if (!supabase) return null;
  if (entry.leg_id) {
    const { data: existing } = await supabase.from('component_time_entries')
      .select('id').eq('component_id', entry.component_id).eq('leg_id', entry.leg_id).maybeSingle();
    if (existing) {
      await supabase.from('component_time_entries')
        .update({ hours_delta: entry.hours_delta, cycles_delta: entry.cycles_delta, time_source: entry.time_source })
        .eq('id', existing.id);
    } else {
      await supabase.from('component_time_entries').insert(entry);
    }
  } else {
    await supabase.from('component_time_entries').insert(entry);
  }
  return recomputeTotals(supabase, entry.component_id);
}
