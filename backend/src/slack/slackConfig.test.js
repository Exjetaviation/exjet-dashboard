// backend/src/slack/slackConfig.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSlackConfig } from './slackConfig.js';

test('parses enabled flag, token, interval, and member lists', () => {
  const cfg = parseSlackConfig({
    SLACK_TRIP_CHANNELS: 'on',
    SLACK_BOT_TOKEN: 'xoxb-1',
    SLACK_WATCH_INTERVAL_MS: '30000',
    SLACK_OPS_MEMBERS: 'U1, U2 ,U3',
    SLACK_ACCOUNTING_MEMBERS: 'U9',
    SLACK_MANAGEMENT_MEMBERS: '',
  });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.botToken, 'xoxb-1');
  assert.equal(cfg.intervalMs, 30000);
  assert.deepEqual(cfg.opsMembers, ['U1', 'U2', 'U3']);
  assert.deepEqual(cfg.accountingMembers, ['U9']);
  assert.deepEqual(cfg.managementMembers, []);
});

test('defaults: disabled, 60s interval, empty lists', () => {
  const cfg = parseSlackConfig({});
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.botToken, null);
  assert.equal(cfg.intervalMs, 60000);
  assert.deepEqual(cfg.opsMembers, []);
});
