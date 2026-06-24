import Papa from 'papaparse';
import { num } from './csv.js';

const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
// WFS dates look like "04-Jun-26" → "2026-06-04". Case-insensitive month.
const parseWfsDate = (s) => {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/.exec((s || '').trim());
  if (!m) return null;
  const key = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();
  if (!MONTHS[key]) return null;
  return `20${m[3]}-${MONTHS[key]}-${m[1].padStart(2, '0')}`;
};
// Fuel type is embedded in the Notes free text: "**Price for fuel item: JET FUEL**".
const fuelType = (notes) => {
  const m = /Price for fuel item:\s*([^*]+?)\s*\*/i.exec(notes || '');
  return (m && m[1].trim()) ? m[1].trim() : null;
};

// Parse a WFS fuel CSV into normalized rows. effectiveDate = the email's received date
// (WFS files carry no date in the name).
export const parseWfs = (csvText, { sourceFile = null, effectiveDate = null } = {}) => {
  const { data } = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  const out = [];
  for (const r of data) {
    const icao = (r.ICAO || '').trim().toUpperCase();
    const price = num(r['Estimated Price']);
    if (!icao || price == null || price <= 0) continue; // skip rows without an airport or a usable price
    out.push({
      vendor: 'wfs',
      icao,
      fbo_name: (r.Supplier || '').trim() || null,
      fbo_alt_name: null,
      fuel_type: fuelType(r.Notes),
      tier_from_gal: num(r['Gal From']),
      tier_to_gal: num(r['Gal To']),
      price,
      taxes: num(r['Estimated Taxes']),
      total_price: num(r['Estimated Total Price']),
      currency: 'USD',
      exp_date: parseWfsDate(r['Exp Date']),
      city: (r.City || '').trim() || null,
      country: (r['Country/State'] || '').trim() || null,
      notes: (r.Notes || '').trim() || null,
      source_file: sourceFile,
      effective_date: effectiveDate,
    });
  }
  return out;
};
