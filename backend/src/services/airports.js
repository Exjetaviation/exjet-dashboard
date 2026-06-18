// Minimal ICAO -> [lat,lng] for drawing the quote route map. Extend as needed;
// unknown codes return null so the map degrades to "unavailable" gracefully.
const COORDS = {
  KFXE: [26.197, -80.171], EHAM: [52.309, 4.764], LGAV: [37.937, 23.945],
  LGKR: [39.602, 19.911], LFPG: [49.010, 2.548], TJSJ: [18.439, -66.002],
};
export function resolveLegCoords(legs) {
  return legs.map((l) => ({ ...l, fromLatLng: COORDS[l.from] || null, toLatLng: COORDS[l.to] || null }));
}
