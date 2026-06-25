// backend/src/scheduling/flightInfoStore.js
// Soft-fail flight_info store + pure OOOI helpers.

function minutesBetween(a, b) {
  if (!a || !b) return null;
  const t0 = new Date(a).getTime(); const t1 = new Date(b).getTime();
  if (Number.isNaN(t0) || Number.isNaN(t1)) return null;
  return Math.round((t1 - t0) / 60000);
}

export function deriveMinutes(fi) {
  return { flight_minutes: minutesBetween(fi?.off_at, fi?.on_at),
           block_minutes: minutesBetween(fi?.out_at, fi?.in_at) };
}

const ms2iso = (v) => (v == null ? null : new Date(typeof v === 'number' ? v : Number(v)).toISOString());

export function prefillFromBlock(block) {
  if (!block) return {};
  const out = {};
  if (block.out != null) out.out_at = ms2iso(block.out);
  if (block.off != null) out.off_at = ms2iso(block.off);
  if (block.on != null) out.on_at = ms2iso(block.on);
  if (block.in != null) out.in_at = ms2iso(block.in);
  return out;
}

export async function getFlightInfo(supabase, legId) {
  if (!supabase) return null;
  const { data, error } = await supabase.from('flight_info')
    .select('*, flight_info_crew(*)').eq('scheduling_leg_id', legId).maybeSingle();
  if (error) { console.warn('[flightInfo] get soft-fail:', error.message); return null; }
  return data || null;
}

export async function upsertFlightInfo(supabase, legId, patch) {
  if (!supabase) return null;
  const payload = { ...patch, scheduling_leg_id: legId, updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from('flight_info')
    .upsert(payload, { onConflict: 'scheduling_leg_id' }).select().single();
  if (error) { console.warn('[flightInfo] upsert soft-fail:', error.message); return null; }
  return data;
}

export async function markComplete(supabase, legId, userEmail) {
  if (!supabase) return null;
  const { data, error } = await supabase.from('flight_info')
    .update({ status: 'complete', completed_at: new Date().toISOString(), completed_by: userEmail, updated_at: new Date().toISOString() })
    .eq('scheduling_leg_id', legId).select().single();
  if (error) { console.warn('[flightInfo] complete soft-fail:', error.message); return null; }
  return data;
}

export async function replaceCrew(supabase, flightInfoId, crewRows) {
  if (!supabase || !flightInfoId) return;
  await supabase.from('flight_info_crew').delete().eq('flight_info_id', flightInfoId);
  const rows = (crewRows || []).filter(Boolean).map((c) => ({
    flight_info_id: flightInfoId,
    crew_lf_oid: c.crew_lf_oid ?? null,
    role: c.role ?? null,
    performed_takeoff: c.performed_takeoff ?? null,
    performed_landing: c.performed_landing ?? null,
    imc_hours: c.imc_hours ?? null,
    night_hours: c.night_hours ?? null,
  }));
  if (rows.length) await supabase.from('flight_info_crew').insert(rows);
}
