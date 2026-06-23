// backend/src/slack/slackConfig.js
//
// Parse the Slack-channels env into a plain config object. Member vars are
// comma-separated Slack user IDs (e.g. "U123,U456").
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

export function parseSlackConfig(env = process.env) {
  return {
    enabled: env.SLACK_TRIP_CHANNELS === 'on',
    botToken: env.SLACK_BOT_TOKEN || null,
    intervalMs: Number(env.SLACK_WATCH_INTERVAL_MS) || 60000,
    opsMembers: list(env.SLACK_OPS_MEMBERS),
    accountingMembers: list(env.SLACK_ACCOUNTING_MEMBERS),
    managementMembers: list(env.SLACK_MANAGEMENT_MEMBERS),
  };
}
