// Shared CSV coercion for the fuel parsers. Empty/blank/non-numeric → null, so blank
// price columns are SKIPPED rather than silently stored as 0 (Number('') === 0).
export const num = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
