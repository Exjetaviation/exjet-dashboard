// Pure selector: from all rate cards for one tail, pick the card for the requested
// purpose ('owner' | 'charter'); else a purpose-less (default) card; else the first.
export const selectRateCard = (cards, purpose) => {
  const list = Array.isArray(cards) ? cards : [];
  if (!list.length) return null;
  return (
    list.find((c) => c.purpose === purpose) ||
    list.find((c) => c.purpose == null || c.purpose === '') ||
    list[0]
  );
};
