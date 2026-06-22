import { supabase } from './supabase.js';
import { getAirportFbos } from './levelflight.js';

// Pure: parse LevelFlight's FBO response into airport_fbos rows. LF `loc.coordinates`
// is GeoJSON [lng, lat].
export const fbosFromLfResponse = (json, icao) => {
  const fbos = json?.fbos;
  if (!fbos || typeof fbos !== 'object') return [];
  const ic = (icao || '').trim().toUpperCase();
  return Object.values(fbos).map((f) => ({
    fbo_id: String(f.id),
    icao: ic,
    name: f.name || null,
    address: f.address || null,
    lng: Array.isArray(f.loc?.coordinates) ? (f.loc.coordinates[0] ?? null) : null,
    lat: Array.isArray(f.loc?.coordinates) ? (f.loc.coordinates[1] ?? null) : null,
    phones: Array.isArray(f.phones) ? f.phones : null,
    fax: f.fax || null,
    email: f.email || null,
    website: f.website || null,
    comms: f.comms || null,
    hours: f.hours || null,
    raw: f,
  }));
};

// Fetch + parse FBOs for an airport from LevelFlight.
export const fetchAirportFbos = async (icao) => fbosFromLfResponse(await getAirportFbos(icao), icao);

// Upsert FBO rows (idempotent on fbo_id).
export const upsertFbos = async (rows) => {
  if (!rows?.length) return { count: 0 };
  const { error } = await supabase.from('airport_fbos').upsert(rows, { onConflict: 'fbo_id' });
  if (error) throw error;
  return { count: rows.length };
};

// FBOs for an airport from our DB.
export const listFbos = async (icao) => {
  const { data, error } = await supabase.from('airport_fbos').select('*').eq('icao', (icao || '').trim().toUpperCase());
  if (error) return [];
  return data || [];
};
