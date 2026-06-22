// Native fleet reference — aircraft type + seat count per tail. LevelFlight carries
// this on aircraft.type.name / aircraft.paxSeats; native quotes don't call LF, so we
// keep a small static map. Extend as the fleet changes.
const FLEET = {
  N408JS: { type: 'Gulfstream GIV SP', maxPax: 15 },
  N69FP:  { type: 'Gulfstream GIV SP', maxPax: 15 },
};

export const aircraftInfo = (tail) => FLEET[(tail || '').trim().toUpperCase()] || { type: null, maxPax: null };
