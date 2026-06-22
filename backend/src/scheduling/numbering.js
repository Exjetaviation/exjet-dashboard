import { supabase } from '../services/supabase.js';
import { nextNumber } from './nextNumber.js';

export { nextNumber };

const QUOTE_BASE = 3000;
const TRIP_BASE = 26000;

// Full-table read is intentional: quote_number/trip_number are stored as TEXT, so a
// DB-side ORDER BY would sort lexically ('999' > '3007') and pick the wrong max. We
// fetch the column and compute the numeric max in nextNumber.
const fetchColumn = async (column) => {
  const { data, error } = await supabase.from('scheduling_trips').select(column);
  if (error) return []; // soft-fail: degrade to base on error
  return (data || []).map((r) => r[column]);
};

export const nextQuoteNumber = async () => nextNumber(await fetchColumn('quote_number'), QUOTE_BASE);
export const nextTripNumber = async () => nextNumber(await fetchColumn('trip_number'), TRIP_BASE);
