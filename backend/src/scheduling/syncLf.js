// backend/src/scheduling/syncLf.js
//
// Real `lf` adapter for the sync orchestrator. Fetches one month of scheduled
// legs from LevelFlight, reusing the dashboard's authenticated lfPost (Cognito
// token refresh handled there). Returns a bare array of raw legs.
import { lfPost } from '../agent/providers/levelflight.js';
import { unwrapArray } from './lfNormalize.js';

export const syncLf = {
  async scheduledLegs(startMs) {
    const payload = await lfPost('/api/analytics/scheduledLegs', { start: startMs });
    return unwrapArray(payload, ['legs', 'scheduledLegs', 'data', 'items', 'results']);
  },
};
