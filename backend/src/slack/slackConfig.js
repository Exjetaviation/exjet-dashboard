// backend/src/slack/slackConfig.js
//
// Parse the Slack-channels env into a plain config object. Member vars are
// comma-separated Slack user IDs (e.g. "U123,U456").
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
// Accept common truthy spellings so "true"/"ON"/"1" don't silently disable it.
const truthy = (v) => ['on', 'true', '1', 'yes'].includes(String(v || '').trim().toLowerCase());

export function parseSlackConfig(env = process.env) {
  return {
    enabled: truthy(env.SLACK_TRIP_CHANNELS),
    botToken: env.SLACK_BOT_TOKEN || null,
    intervalMs: Number(env.SLACK_WATCH_INTERVAL_MS) || 60000,
    opsMembers: list(env.SLACK_OPS_MEMBERS),
    accountingMembers: list(env.SLACK_ACCOUNTING_MEMBERS),
    managementMembers: list(env.SLACK_MANAGEMENT_MEMBERS),
    // Only provision trips first mirrored at/after this ISO cutoff (skips the
    // historical backlog). The watcher defaults it to its boot time when unset.
    since: env.SLACK_CHANNELS_SINCE || null,
  };
}
