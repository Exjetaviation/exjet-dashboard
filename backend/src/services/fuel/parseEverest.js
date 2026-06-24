import Papa from 'papaparse';
import { num } from './csv.js';

// Everest files carry the price date in the FILENAME: "Everest Fuel_06_23_2026.csv".
export const everestDateFromFilename = (name) => {
  const m = /(\d{2})_(\d{2})_(\d{4})/.exec(name || '');
  if (!m) return null;
  const mm = Number(m[1]), dd = Number(m[2]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${m[3]}-${m[1]}-${m[2]}`;
};

// Parse an Everest fuel CSV into normalized rows. TIER is the min-gallons floor for the price.
export const parseEverest = (csvText, { sourceFile = null, effectiveDate = null } = {}) => {
  const { data } = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  const out = [];
  for (const r of data) {
    const icao = (r.ICAO || '').trim().toUpperCase();
    const price = num(r.PRICE);
    if (!icao || price == null || price <= 0) continue;
    out.push({
      vendor: 'everest',
      icao,
      fbo_name: (r.FBO || '').trim() || null,
      fbo_alt_name: (r.NAME || '').trim() || null,
      fuel_type: 'JET-A',
      tier_from_gal: num(r.TIER),
      tier_to_gal: null,
      price,
      taxes: null,
      total_price: null,
      currency: 'USD',
      exp_date: null,
      city: null,
      country: null,
      notes: null,
      source_file: sourceFile,
      effective_date: effectiveDate,
    });
  }
  return out;
};
