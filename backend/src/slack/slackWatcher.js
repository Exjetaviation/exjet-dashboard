// backend/src/slack/slackWatcher.js
//
// Background worker: poll LF for new dispatches and provision Slack channels.
// Opt-in via SLACK_TRIP_CHANNELS=on (mirrors startSyncWorker). Independent of
// the heavy SCHEDULING_SYNC worker.
import { parseSlackConfig } from './slackConfig.js';
import { provisionNewTrips, topUpMembership } from './slackTripChannels.js';
import { getDispatchList } from '../services/levelflight.js';
import * as slack from '../services/slack.js';
import * as channelStore from '../services/slackChannelStore.js';
import { getTripLegSnapshots } from '../services/tripCrewStore.js';
import { getOverrideMap } from '../services/slackOverrideStore.js';
import { getUserIndex } from '../services/lfUserDirectory.js';

let started = false;

export function startSlackWatcher() {
  const config = parseSlackConfig();
  if (!config.enabled) return; // opt-in
  if (!config.botToken) {
    console.warn('[slack-channels] SLACK_TRIP_CHANNELS=on but SLACK_BOT_TOKEN missing — disabled');
    return;
  }
  if (started) return;
  started = true;

  const lf = { listDispatches: () => getDispatchList(1) };
  const store = { ...channelStore, getTripLegSnapshots };
  const dir = { getUserIndex: (now) => getUserIndex(now) };
  const overrides = { getOverrideMap };

  const run = async () => {
    const now = Date.now();
    try {
      await provisionNewTrips({ lf, slack, store, dir, overrides, config, now });
      await topUpMembership({ slack, store, dir, overrides, config, now });
    } catch (e) {
      console.warn('[slack-channels] tick failed:', e?.message || e);
    }
  };

  run();
  setInterval(run, config.intervalMs);
  console.log(`[slack-channels] watcher started (every ${config.intervalMs}ms)`);
}
