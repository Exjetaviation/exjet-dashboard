// backend/src/slack/slackWatcher.js
//
// Background worker: detect new booked trips from the scheduling mirror and
// provision Slack channels. Opt-in via SLACK_TRIP_CHANNELS=on (mirrors
// startSyncWorker). Reads the mirror that the SCHEDULING_SYNC worker keeps fresh.
import { parseSlackConfig } from './slackConfig.js';
import { provisionNewTrips, topUpMembership } from './slackTripChannels.js';
import * as slack from '../services/slack.js';
import * as channelStore from '../services/slackChannelStore.js';
import { getTripLegSnapshots, getCandidateTrips } from '../services/tripCrewStore.js';
import { getOverrideMap } from '../services/slackOverrideStore.js';
import { getUserIndex } from '../services/lfUserDirectory.js';

let started = false;

export function startSlackWatcher() {
  const config = parseSlackConfig();
  if (!config.enabled) {
    // Log on the disabled path so a misset flag isn't invisible (value is not a secret).
    console.log(`[slack-channels] disabled (SLACK_TRIP_CHANNELS=${process.env.SLACK_TRIP_CHANNELS ?? 'unset'})`);
    return;
  }
  if (!config.botToken) {
    console.warn('[slack-channels] SLACK_TRIP_CHANNELS=on but SLACK_BOT_TOKEN missing — disabled');
    return;
  }
  if (started) return;
  started = true;

  // Default the cutoff to boot time so a first deploy never back-provisions the
  // historical backlog — only trips mirrored after we start get channels.
  config.since = config.since || new Date().toISOString();

  const store = { ...channelStore, getTripLegSnapshots, getCandidateTrips };
  const dir = { getUserIndex: (now) => getUserIndex(now) };
  const overrides = { getOverrideMap };

  const run = async () => {
    const now = Date.now();
    try {
      await provisionNewTrips({ slack, store, dir, overrides, config, now });
      await topUpMembership({ slack, store, dir, overrides, config, now });
    } catch (e) {
      console.warn('[slack-channels] tick failed:', e?.message || e);
    }
  };

  run();
  setInterval(run, config.intervalMs);
  console.log(`[slack-channels] watcher started (every ${config.intervalMs}ms, since ${config.since})`);
}
