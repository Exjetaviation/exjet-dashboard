import { supabase } from '../services/supabase.js';

// Pure: the next number = one above the largest numeric value present, but never
// below `base`. Provisional scheme — the real Quote#/Trip# numbering is decided
// during the LevelFlight cutoff.
export const nextNumber = (numbers, base) => {
  const max = (numbers || [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .reduce((m, v) => Math.max(m, v), base - 1);
  return max + 1;
};

const QUOTE_BASE = 3000;
const TRIP_BASE = 26000;

const fetchColumn = async (column) => {
  const { data, error } = await supabase.from('scheduling_trips').select(column);
  if (error) return []; // soft-fail: degrade to base on error
  return (data || []).map((r) => r[column]);
};

export const nextQuoteNumber = async () => nextNumber(await fetchColumn('quote_number'), QUOTE_BASE);
export const nextTripNumber = async () => nextNumber(await fetchColumn('trip_number'), TRIP_BASE);
