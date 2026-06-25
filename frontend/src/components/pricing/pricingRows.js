// Pure helpers shared by PricingSummary + PricingSlideOut.

// Decimal hours -> "H:MM".
export const fmtHrs = (hrs) => {
  const m = Math.round((Number(hrs) || 0) * 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};

// Build an onPatch payload that pins a line to a manual dollar amount.
export const pinPatch = (overrides, line, value) => ({
  overrides: { ...(overrides || {}), [line]: Number(value) || 0 },
});

// Build an onPatch payload that removes a line's pin.
export const unpinPatch = (overrides, line) => {
  const next = { ...(overrides || {}) };
  delete next[line];
  return { overrides: next };
};

export const usd = (nv) => (nv == null ? '—' : '$' + Number(nv).toLocaleString('en-US'));

// Ensure a pricing object has fees[]/fetEnabled defaults and numeric core fields, so
// autosave keys don't churn (missing fees/fetEnabled, string vs number) and fire
// redundant saves. `purpose` defaults fetEnabled (owner => off). No-op on null/error.
export const normalizePricing = (p, purpose) => {
  if (!p || p.error) return p;
  const out = { ...p };
  out.fees = Array.isArray(p.fees) ? p.fees.map((f) => ({ ...f, amount: Number(f.amount) || 0 })) : [];
  out.fetEnabled = p.fetEnabled === undefined ? (purpose !== 'owner') : p.fetEnabled !== false;
  return out;
};
