// Pure: the next number = one above the largest numeric value present, but never
// below `base`. Provisional scheme — the real Quote#/Trip# numbering is decided
// during the LevelFlight cutoff. Kept import-light (no Supabase) so its unit test
// has no env/DB dependency.
export const nextNumber = (numbers, base) => {
  const max = (numbers || [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .reduce((m, v) => Math.max(m, v), base - 1);
  return max + 1;
};
