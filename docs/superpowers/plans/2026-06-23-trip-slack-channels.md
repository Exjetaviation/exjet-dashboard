# Trip Slack Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-provision two private Slack channels (ops/crew + accounting) for every new LevelFlight trip, pre-populated with the right people, via a lightweight watcher that runs on the existing backend.

**Architecture:** A new opt-in subsystem in `backend/src/slack/` + a few `backend/src/services/` modules. A `setInterval` watcher (default 60s) polls the cheap `getDispatchList(1)` LF endpoint, diffs against a Supabase tracking table, and provisions channels for trips it hasn't seen. Crew oids come from the existing scheduling mirror's leg snapshots; crew emails resolve through a cached LF user directory; emails map to Slack users via `users.lookupByEmail` with a Supabase override table fallback. A per-tick membership top-up adds crew as they get assigned. All orchestration deps are injected for `node:test` unit testing with fakes. The heavy 5-min `SCHEDULING_SYNC` worker is untouched.

**Tech Stack:** Node + Express (ESM), `@supabase/supabase-js`, global `fetch` (Node 18+), Slack Web API (form-encoded), `node:test`.

**Spec:** `docs/superpowers/specs/2026-06-23-trip-slack-channels-design.md`

---

## File Structure

**Create (pure, unit-tested):**
- `backend/src/slack/channelName.js` — trip number → Slack channel slug.
- `backend/src/slack/slackConfig.js` — parse Slack env into a config object.
- `backend/src/slack/dispatchList.js` — normalize `getDispatchList()` response → `[{ oid, tripId }]`.
- `backend/src/slack/crewFromLegSnapshots.js` — extract `[{ oid, role, name, email }]` from leg snapshots.
- `backend/src/slack/resolveMembers.js` — crew + fixed groups + lookups → `{ inviteIds, unmatched }` (pure/sync).
- `backend/src/services/lfUserDirectory.js` — `indexUsers` (pure) + cached `getUserIndex` (I/O).
- `backend/src/slack/slackTripChannels.js` — orchestrator: `provisionNewTrips` + `topUpMembership` (DI, unit-tested with fakes).

**Create (I/O — exercised via fakes / manual verify):**
- `backend/src/services/slack.js` — Slack Web API wrapper (create/invite/lookup/post + 429 backoff).
- `backend/src/services/slackChannelStore.js` — soft-fail CRUD on `trip_slack_channels`.
- `backend/src/services/slackOverrideStore.js` — soft-fail read of `slack_user_overrides`.
- `backend/src/services/tripCrewStore.js` — soft-fail read of leg snapshots for a dispatch.
- `backend/src/slack/slackWatcher.js` — opt-in boot + interval; composes real adapters.
- `backend/migrations/018_slack_trip_channels.sql` — the two tables.

**Modify:**
- `backend/src/index.js` — call `startSlackWatcher()` alongside the other workers.

**Test command (used throughout):**
```
node --test backend/src/slack/*.test.js backend/src/services/*.test.js
```

---

## Task 1: Migration — `trip_slack_channels` + `slack_user_overrides`

**Files:**
- Create: `backend/migrations/018_slack_trip_channels.sql`

Migrations are applied MANUALLY in the Supabase SQL editor (no runner). This task only writes and commits the SQL; the user applies it during rollout (Task 12). Stores soft-fail until it's applied.

- [ ] **Step 1: Write the migration**

```sql
-- 018_slack_trip_channels.sql
-- Auto-provisioned Slack channels per LevelFlight trip (ops + accounting),
-- plus a manual LF-email -> Slack-user override map for crew whose emails differ.

create table if not exists trip_slack_channels (
  lf_dispatch_oid    text primary key,           -- LF dispatch id; the idempotency key
  trip_id            text,                        -- human trip number
  ops_channel_id     text,                        -- Slack channel id (ops/crew)
  acct_channel_id    text,                        -- Slack channel id (accounting)
  invited_slack_ids  jsonb not null default '[]'::jsonb,  -- Slack user ids already invited (top-up dedup)
  first_dep_at       timestamptz,                 -- earliest leg departure (bounds the top-up loop)
  status             text not null default 'ok',  -- 'ok' | 'error'
  created_at         timestamptz not null default now()
);

create table if not exists slack_user_overrides (
  lf_email       text primary key,    -- lowercased LF email
  slack_user_id  text not null,       -- Slack user id (e.g. U0123ABCD)
  note           text,
  created_at     timestamptz not null default now()
);
```

- [ ] **Step 2: Commit**

```bash
git add backend/migrations/018_slack_trip_channels.sql
git commit -m "feat(slack): migration 018 — trip_slack_channels + slack_user_overrides"
```

---

## Task 2: `channelName.js` — trip number → Slack slug

**Files:**
- Create: `backend/src/slack/channelName.js`
- Test: `backend/src/slack/channelName.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/src/slack/channelName.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { channelName } from './channelName.js';

test('builds ops and accounting channel names from a trip number', () => {
  assert.equal(channelName(25104, 'ops'), 'trip-25104');
  assert.equal(channelName('25104', 'acct'), 'trip-25104-acct');
});

test('slugifies spaces/symbols and lowercases', () => {
  assert.equal(channelName('AB 12/3', 'ops'), 'trip-ab-12-3');
});

test('falls back when trip id is missing', () => {
  assert.equal(channelName(null, 'ops'), 'trip-unknown');
  assert.equal(channelName('', 'acct'), 'trip-unknown-acct');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/slack/channelName.test.js`
Expected: FAIL — `Cannot find module './channelName.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/slack/channelName.js
//
// Build a Slack-safe channel name from a LevelFlight trip number.
// kind: 'ops' -> "trip-<n>", 'acct' -> "trip-<n>-acct".
export function channelName(tripId, kind) {
  const slug = String(tripId ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = `trip-${slug || 'unknown'}`;
  const name = kind === 'acct' ? `${base}-acct` : base;
  return name.slice(0, 80); // Slack channel-name max length
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/slack/channelName.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/slack/channelName.js backend/src/slack/channelName.test.js
git commit -m "feat(slack): channelName slug builder"
```

---

## Task 3: `slackConfig.js` — parse env

**Files:**
- Create: `backend/src/slack/slackConfig.js`
- Test: `backend/src/slack/slackConfig.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/slack/slackConfig.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/slack/slackConfig.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/slack/slackConfig.js backend/src/slack/slackConfig.test.js
git commit -m "feat(slack): parseSlackConfig env parser"
```

---

## Task 4: `dispatchList.js` — normalize the LF dispatch list

**Files:**
- Create: `backend/src/slack/dispatchList.js`
- Test: `backend/src/slack/dispatchList.test.js`

The `POST /api/dispatch/list` response shape is undocumented (`additionalProperties: true`), so normalize defensively with field-path fallbacks, mirroring `scheduling/mapScheduledLegs.js`. Reuse `oidToStr` from `scheduling/lfNormalize.js`.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/slack/dispatchList.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDispatchList } from './dispatchList.js';

test('reads dispatches array with oid + tripId', () => {
  const raw = { success: true, dispatches: [
    { _id: { $oid: 'disp1' }, tripId: 25104 },
    { _id: { $oid: 'disp2' }, tripNumber: '25105' },
  ] };
  assert.deepEqual(normalizeDispatchList(raw), [
    { oid: 'disp1', tripId: '25104' },
    { oid: 'disp2', tripId: '25105' },
  ]);
});

test('accepts a bare array and skips rows without an oid', () => {
  const raw = [{ oid: 'd3', tripId: 9 }, { tripId: 10 }];
  assert.deepEqual(normalizeDispatchList(raw), [{ oid: 'd3', tripId: '9' }]);
});

test('returns [] for junk input', () => {
  assert.deepEqual(normalizeDispatchList(null), []);
  assert.deepEqual(normalizeDispatchList({}), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/slack/dispatchList.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/slack/dispatchList.js
//
// Normalize getDispatchList() (POST /api/dispatch/list) into [{ oid, tripId }].
// The LF response shape is undocumented, so use field-path fallbacks.
import { oidToStr } from '../scheduling/lfNormalize.js';

export function normalizeDispatchList(raw) {
  const rows = Array.isArray(raw) ? raw : (raw?.dispatches || raw?.data || []);
  const out = [];
  for (const d of rows || []) {
    const oid = oidToStr(d?._id?.$oid) || oidToStr(d?._id) || oidToStr(d?.oid) || oidToStr(d?.id);
    if (!oid) continue;
    const tripRaw = d?.tripId ?? d?.tripNumber ?? d?.trip_number ?? d?.number ?? null;
    out.push({ oid, tripId: tripRaw != null ? String(tripRaw) : null });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/slack/dispatchList.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/slack/dispatchList.js backend/src/slack/dispatchList.test.js
git commit -m "feat(slack): normalizeDispatchList"
```

---

## Task 5: `crewFromLegSnapshots.js` — extract crew from mirror snapshots

**Files:**
- Create: `backend/src/slack/crewFromLegSnapshots.js`
- Test: `backend/src/slack/crewFromLegSnapshots.test.js`

Leg snapshots carry `pilots: [{ user, seat }]` and `attendants: [{ user, seat }]`. Seats: 2=PIC, 3=SIC, 7=FA (per `scheduling/crewAssignment.js`). Dedup by user oid across all legs. `email` may be present (native legs) or null (resolved later via the directory).

- [ ] **Step 1: Write the failing test**

```js
// backend/src/slack/crewFromLegSnapshots.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crewFromLegSnapshots } from './crewFromLegSnapshots.js';

const leg1 = {
  pilots: [
    { seat: 2, user: { _id: { $oid: 'pic1' }, firstName: 'Ann', lastName: 'Pic', email: 'ann@x.com' } },
    { seat: 3, user: { _id: { $oid: 'sic1' }, firstName: 'Sam', lastName: 'Sic' } },
  ],
  attendants: [{ seat: 7, user: { _id: { $oid: 'fa1' }, firstName: 'Fay' } }],
};
const leg2 = { pilots: [{ seat: 2, user: { _id: { $oid: 'pic1' } } }] }; // dup PIC

test('extracts pilots + attendants, dedups by oid, maps roles', () => {
  const crew = crewFromLegSnapshots([leg1, leg2]);
  assert.deepEqual(crew, [
    { oid: 'pic1', role: 'PIC', name: 'Ann Pic', email: 'ann@x.com' },
    { oid: 'sic1', role: 'SIC', name: 'Sam Sic', email: null },
    { oid: 'fa1', role: 'FA', name: 'Fay', email: null },
  ]);
});

test('handles empty / missing arrays', () => {
  assert.deepEqual(crewFromLegSnapshots([]), []);
  assert.deepEqual(crewFromLegSnapshots([{}]), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/slack/crewFromLegSnapshots.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/slack/crewFromLegSnapshots.js
//
// Extract a trip's crew (pilots + attendants) from its leg snapshots.
// Returns deduped [{ oid, role, name, email }]. Seats: 2=PIC, 3=SIC, 7=FA.
import { oidToStr } from '../scheduling/lfNormalize.js';

const roleForSeat = (seat) => (seat === 2 ? 'PIC' : seat === 3 ? 'SIC' : seat === 7 ? 'FA' : 'crew');

export function crewFromLegSnapshots(legSnapshots = []) {
  const byOid = new Map();
  for (const snap of legSnapshots || []) {
    const members = [
      ...(Array.isArray(snap?.pilots) ? snap.pilots : []),
      ...(Array.isArray(snap?.attendants) ? snap.attendants : []),
    ];
    for (const m of members) {
      const u = m?.user || m;
      const oid = oidToStr(u?._id?.$oid) || oidToStr(u?._id) || oidToStr(u?.oid) || oidToStr(u?.id);
      if (!oid || byOid.has(oid)) continue;
      const name = [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || u?.name || null;
      byOid.set(oid, { oid, role: roleForSeat(m?.seat), name, email: u?.email || null });
    }
  }
  return [...byOid.values()];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/slack/crewFromLegSnapshots.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/slack/crewFromLegSnapshots.js backend/src/slack/crewFromLegSnapshots.test.js
git commit -m "feat(slack): crewFromLegSnapshots extractor"
```

---

## Task 6: `resolveMembers.js` — people → Slack ids to invite

**Files:**
- Create: `backend/src/slack/resolveMembers.js`
- Test: `backend/src/slack/resolveMembers.test.js`

Pure and synchronous: the orchestrator does the async `lookupByEmail` first and passes the results in as plain lookup functions. Fixed group ids are always included. Each crew member resolves email (own → directory), then Slack id (lookup → override); unresolved crew are flagged.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/slack/resolveMembers.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMembers } from './resolveMembers.js';

test('includes fixed groups, matches crew by email, dedups', () => {
  const r = resolveMembers({
    crew: [
      { oid: 'p1', name: 'Ann', email: 'ann@x.com' },
      { oid: 'p2', name: 'Bob', email: null },
    ],
    fixedGroupIds: ['UOPS1', 'UOPS1'],
    dirEmailForOid: (oid) => (oid === 'p2' ? 'bob@x.com' : null),
    slackIdForEmail: (e) => ({ 'ann@x.com': 'UANN', 'bob@x.com': 'UBOB' }[e] || null),
    overrideForEmail: () => null,
  });
  assert.deepEqual(r.inviteIds.sort(), ['UANN', 'UBOB', 'UOPS1']);
  assert.deepEqual(r.unmatched, []);
});

test('falls back to override, flags the truly unmatched', () => {
  const r = resolveMembers({
    crew: [
      { oid: 'p1', name: 'Ann', email: 'ann@x.com' },   // only in override
      { oid: 'p3', name: 'Cy', email: 'cy@x.com' },      // nowhere
    ],
    fixedGroupIds: [],
    dirEmailForOid: () => null,
    slackIdForEmail: () => null,
    overrideForEmail: (e) => (e === 'ann@x.com' ? 'UANN' : null),
  });
  assert.deepEqual(r.inviteIds, ['UANN']);
  assert.deepEqual(r.unmatched, [{ name: 'Cy', email: 'cy@x.com' }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/slack/resolveMembers.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/slack/resolveMembers.js
//
// Resolve a channel's people into a deduped list of Slack user ids to invite.
// Pure/sync — the caller performs async lookups and passes them as functions.
//
//   crew:            [{ oid, name, email|null }]
//   fixedGroupIds:   string[]  (already Slack ids; always invited)
//   dirEmailForOid:  (oid)   => email|null   (LF user directory)
//   slackIdForEmail: (email) => slackId|null (users.lookupByEmail results)
//   overrideForEmail:(email) => slackId|null (slack_user_overrides)
// Returns { inviteIds: string[], unmatched: [{ name, email|null }] }.
export function resolveMembers({
  crew = [],
  fixedGroupIds = [],
  dirEmailForOid = () => null,
  slackIdForEmail = () => null,
  overrideForEmail = () => null,
} = {}) {
  const ids = new Set(fixedGroupIds.filter(Boolean));
  const unmatched = [];
  for (const c of crew) {
    const email = (c.email || dirEmailForOid(c.oid) || '').toLowerCase() || null;
    const slackId = email ? (slackIdForEmail(email) || overrideForEmail(email)) : null;
    if (slackId) ids.add(slackId);
    else unmatched.push({ name: c.name || null, email });
  }
  return { inviteIds: [...ids], unmatched };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/slack/resolveMembers.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/slack/resolveMembers.js backend/src/slack/resolveMembers.test.js
git commit -m "feat(slack): resolveMembers"
```

---

## Task 7: `lfUserDirectory.js` — cached oid → email index

**Files:**
- Create: `backend/src/services/lfUserDirectory.js`
- Test: `backend/src/services/lfUserDirectory.test.js`

`indexUsers` is pure (unit-tested). `getUserIndex` fetches the three LF directories, caches for 30 min, and is exercised in rollout. Email field name is unverified — fall back across `email`/`emailAddress`/`primaryEmail` (Task 12 confirms structure-only).

- [ ] **Step 1: Write the failing test**

```js
// backend/src/services/lfUserDirectory.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexUsers } from './lfUserDirectory.js';

test('indexes oid -> { email, name } across multiple lists', () => {
  const users = [{ _id: { $oid: 'u1' }, firstName: 'Ann', lastName: 'P', email: 'ann@x.com' }];
  const pilots = { pilots: [{ _id: { $oid: 'u2' }, firstName: 'Bo', emailAddress: 'bo@x.com' }] };
  const map = indexUsers([users, pilots]);
  assert.equal(map.get('u1').email, 'ann@x.com');
  assert.equal(map.get('u1').name, 'Ann P');
  assert.equal(map.get('u2').email, 'bo@x.com');
});

test('prefers the entry that has an email when oid repeats; skips oid-less rows', () => {
  const a = [{ _id: { $oid: 'u1' }, firstName: 'Ann' }];            // no email
  const b = [{ _id: { $oid: 'u1' }, email: 'ann@x.com' }, { name: 'x' }];
  const map = indexUsers([a, b]);
  assert.equal(map.get('u1').email, 'ann@x.com');
  assert.equal(map.size, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/services/lfUserDirectory.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/services/lfUserDirectory.js
//
// Cached LevelFlight user directory: oid -> { email, name }. Crew on leg
// snapshots carry only an oid, so this is the authoritative email source.
import { oidToStr } from '../scheduling/lfNormalize.js';
import { getUsers, getPilotsList, getAttendants } from './levelflight.js';

const rowsOf = (list) =>
  Array.isArray(list) ? list : (list?.users || list?.pilots || list?.attendants || list?.data || []);

// Pure: merge raw LF user lists into a Map(oid -> { email, name }).
export function indexUsers(rawLists = []) {
  const map = new Map();
  for (const list of rawLists) {
    for (const u of rowsOf(list)) {
      const oid = oidToStr(u?._id?.$oid) || oidToStr(u?._id) || oidToStr(u?.oid) || oidToStr(u?.id);
      if (!oid) continue;
      const email = u?.email || u?.emailAddress || u?.primaryEmail || null;
      const name = [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || u?.name || null;
      const prev = map.get(oid);
      if (!prev || (!prev.email && email)) map.set(oid, { email: email || null, name: name || prev?.name || null });
    }
  }
  return map;
}

let _cache = { at: 0, map: new Map() };
const TTL_MS = 30 * 60 * 1000;

// Cached index. Best-effort: if a list fetch fails, the others still contribute;
// a fully-failed refresh keeps the last good cache.
export async function getUserIndex(nowMs = Date.now()) {
  if (nowMs - _cache.at < TTL_MS && _cache.map.size) return _cache.map;
  const lists = await Promise.all([
    getUsers().catch(() => null),
    getPilotsList().catch(() => null),
    getAttendants().catch(() => null),
  ]);
  const map = indexUsers(lists.filter(Boolean));
  if (map.size) _cache = { at: nowMs, map };
  return _cache.map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/services/lfUserDirectory.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/lfUserDirectory.js backend/src/services/lfUserDirectory.test.js
git commit -m "feat(slack): cached LF user directory (oid -> email)"
```

---

## Task 8: `services/slack.js` — Slack Web API wrapper

**Files:**
- Create: `backend/src/services/slack.js`

Thin form-encoded wrapper (form-encoding works uniformly for all four methods, including `users.lookupByEmail`). 429 backoff via `retry-after`. No unit test (HTTP I/O, like `services/levelflight.js`); the orchestrator injects a fake. Verified manually in Task 12.

- [ ] **Step 1: Write the module**

```js
// backend/src/services/slack.js
//
// Minimal Slack Web API client (bot token). Form-encoded so one code path covers
// conversations.create / conversations.invite / users.lookupByEmail / chat.postMessage.
import 'dotenv/config';

const SLACK_API = 'https://slack.com/api';
const token = () => process.env.SLACK_BOT_TOKEN || null;

async function call(method, params, { token: tk = token(), fetchImpl = fetch, retries = 3 } = {}) {
  if (!tk) return { ok: false, error: 'no_token' };
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v != null) form.set(k, String(v));
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(`${SLACK_API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${tk}` },
      body: form,
    });
    if (res.status === 429 && attempt < retries) {
      const wait = Number(res.headers.get('retry-after')) || 1;
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    return res.json();
  }
}

async function findChannelByName(name, isPrivate, opts) {
  const r = await call('conversations.list',
    { types: isPrivate ? 'private_channel' : 'public_channel', limit: 1000 }, opts);
  if (!r.ok) return null;
  return (r.channels || []).find((c) => c.name === name) || null;
}

// Create a channel; if the name is taken, adopt the existing one. Returns { id, name } or null.
export async function createChannel(name, { isPrivate = true } = {}, opts = {}) {
  const r = await call('conversations.create', { name, is_private: isPrivate }, opts);
  if (r.ok) return { id: r.channel.id, name: r.channel.name };
  if (r.error === 'name_taken') {
    const found = await findChannelByName(name, isPrivate, opts);
    if (found) return { id: found.id, name: found.name };
  }
  console.warn('[slack] createChannel failed:', name, r.error);
  return null;
}

// Invite users (one call, comma-joined). Returns { invited, failed }.
export async function inviteUsers(channelId, userIds, opts = {}) {
  const ids = (userIds || []).filter(Boolean);
  if (!channelId || !ids.length) return { invited: [], failed: [] };
  const r = await call('conversations.invite', { channel: channelId, users: ids.join(',') }, opts);
  if (r.ok) return { invited: ids, failed: [] };
  // already_in_channel / cant_invite_self are non-fatal.
  if (['already_in_channel', 'cant_invite_self'].includes(r.error)) return { invited: ids, failed: [] };
  console.warn('[slack] inviteUsers failed:', channelId, r.error);
  return { invited: [], failed: ids };
}

export async function lookupByEmail(email, opts = {}) {
  if (!email) return null;
  const r = await call('users.lookupByEmail', { email }, opts);
  return r.ok ? r.user.id : null;
}

export async function postMessage(channelId, text, opts = {}) {
  if (!channelId || !text) return false;
  const r = await call('chat.postMessage', { channel: channelId, text }, opts);
  if (!r.ok) console.warn('[slack] postMessage failed:', channelId, r.error);
  return !!r.ok;
}
```

- [ ] **Step 2: Sanity-check it imports cleanly**

Run: `node -e "import('./backend/src/services/slack.js').then(()=>console.log('ok'))"`
Expected: prints `ok` (no syntax/import errors).

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/slack.js
git commit -m "feat(slack): Slack Web API wrapper"
```

---

## Task 9: Soft-fail stores — channels, overrides, trip crew

**Files:**
- Create: `backend/src/services/slackChannelStore.js`
- Create: `backend/src/services/slackOverrideStore.js`
- Create: `backend/src/services/tripCrewStore.js`

Same soft-fail `getClient()` pattern as `services/legActualsStore.js`: if Supabase isn't configured or the table is absent, every function no-ops (empty set / `[]` / `false`). No unit tests (DB I/O); behavior is covered by the orchestrator's fakes and verified in Task 12.

- [ ] **Step 1: Write `slackChannelStore.js`**

```js
// backend/src/services/slackChannelStore.js
// Soft-failing persistence for trip_slack_channels (migration 018). No-ops if
// Supabase isn't configured or the table is absent. Pattern: legActualsStore.js.
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

let _client = null;
function getClient() {
  if (_client !== null) return _client || null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { _client = false; return null; }
  try { _client = createClient(url, key); return _client; }
  catch (e) { console.warn('[slackChannelStore] init failed (soft):', e.message); _client = false; return null; }
}

// Set of LF dispatch oids that already have channels.
export async function getProvisionedOids() {
  const client = getClient();
  if (!client) return new Set();
  try {
    const { data, error } = await client.from('trip_slack_channels').select('lf_dispatch_oid');
    if (error) { console.warn('[slackChannelStore] getProvisionedOids (soft):', error.message); return new Set(); }
    return new Set((data || []).map((r) => r.lf_dispatch_oid));
  } catch (e) { console.warn('[slackChannelStore] getProvisionedOids (soft):', e?.message || e); return new Set(); }
}

// Insert/replace a provisioned-trip row.
export async function recordChannels({ oid, tripId, opsChannelId, acctChannelId, invitedSlackIds, firstDepAt, status }) {
  const client = getClient();
  if (!client || !oid) return false;
  const row = {
    lf_dispatch_oid: oid,
    trip_id: tripId ?? null,
    ops_channel_id: opsChannelId ?? null,
    acct_channel_id: acctChannelId ?? null,
    invited_slack_ids: invitedSlackIds || [],
    first_dep_at: firstDepAt ?? null,
    status: status || 'ok',
    created_at: new Date().toISOString(),
  };
  try {
    const { error } = await client.from('trip_slack_channels').upsert(row, { onConflict: 'lf_dispatch_oid' });
    if (error) { console.warn('[slackChannelStore] recordChannels (soft):', error.message); return false; }
    return true;
  } catch (e) { console.warn('[slackChannelStore] recordChannels (soft):', e?.message || e); return false; }
}

// Provisioned trips still worth topping up: no known departure, or it's in the future.
export async function getUpcomingProvisioned(nowIso) {
  const client = getClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from('trip_slack_channels')
      .select('lf_dispatch_oid, ops_channel_id, invited_slack_ids, first_dep_at')
      .or(`first_dep_at.is.null,first_dep_at.gte.${nowIso}`);
    if (error) { console.warn('[slackChannelStore] getUpcomingProvisioned (soft):', error.message); return []; }
    return data || [];
  } catch (e) { console.warn('[slackChannelStore] getUpcomingProvisioned (soft):', e?.message || e); return []; }
}

// Replace the invited-ids list for a trip (top-up dedup).
export async function updateInvited(oid, invitedSlackIds) {
  const client = getClient();
  if (!client || !oid) return false;
  try {
    const { error } = await client.from('trip_slack_channels')
      .update({ invited_slack_ids: invitedSlackIds || [] })
      .eq('lf_dispatch_oid', oid);
    if (error) { console.warn('[slackChannelStore] updateInvited (soft):', error.message); return false; }
    return true;
  } catch (e) { console.warn('[slackChannelStore] updateInvited (soft):', e?.message || e); return false; }
}
```

- [ ] **Step 2: Write `slackOverrideStore.js`**

```js
// backend/src/services/slackOverrideStore.js
// Soft-failing read of slack_user_overrides (migration 018): lf_email -> slack_user_id.
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

let _client = null;
function getClient() {
  if (_client !== null) return _client || null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { _client = false; return null; }
  try { _client = createClient(url, key); return _client; }
  catch (e) { console.warn('[slackOverrideStore] init failed (soft):', e.message); _client = false; return null; }
}

// Map(lowercased lf_email -> slack_user_id). Empty on soft-fail.
export async function getOverrideMap() {
  const client = getClient();
  if (!client) return new Map();
  try {
    const { data, error } = await client.from('slack_user_overrides').select('lf_email, slack_user_id');
    if (error) { console.warn('[slackOverrideStore] getOverrideMap (soft):', error.message); return new Map(); }
    return new Map((data || []).map((r) => [String(r.lf_email || '').toLowerCase(), r.slack_user_id]));
  } catch (e) { console.warn('[slackOverrideStore] getOverrideMap (soft):', e?.message || e); return new Map(); }
}
```

- [ ] **Step 3: Write `tripCrewStore.js`**

```js
// backend/src/services/tripCrewStore.js
// Soft-failing read of a dispatch's leg snapshots from the scheduling mirror
// (scheduling_trips -> scheduling_legs.snapshot). Used to derive crew.
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

let _client = null;
function getClient() {
  if (_client !== null) return _client || null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { _client = false; return null; }
  try { _client = createClient(url, key); return _client; }
  catch (e) { console.warn('[tripCrewStore] init failed (soft):', e.message); _client = false; return null; }
}

// Leg snapshots for a dispatch oid (each carries pilots/attendants). [] on soft-fail
// or if the trip hasn't been mirrored yet.
export async function getTripLegSnapshots(dispatchOid) {
  const client = getClient();
  if (!client || !dispatchOid) return [];
  try {
    const { data: trip, error: te } = await client
      .from('scheduling_trips').select('id').eq('lf_oid', dispatchOid).maybeSingle();
    if (te || !trip) return [];
    const { data: legs, error: le } = await client
      .from('scheduling_legs').select('snapshot').eq('trip_id', trip.id);
    if (le) { console.warn('[tripCrewStore] legs (soft):', le.message); return []; }
    return (legs || []).map((l) => l.snapshot).filter(Boolean);
  } catch (e) { console.warn('[tripCrewStore] getTripLegSnapshots (soft):', e?.message || e); return []; }
}
```

- [ ] **Step 4: Sanity-check all three import cleanly**

Run: `node -e "Promise.all(['slackChannelStore','slackOverrideStore','tripCrewStore'].map(m=>import('./backend/src/services/'+m+'.js'))).then(()=>console.log('ok'))"`
Expected: prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/slackChannelStore.js backend/src/services/slackOverrideStore.js backend/src/services/tripCrewStore.js
git commit -m "feat(slack): soft-fail stores (channels, overrides, trip crew)"
```

---

## Task 10: `slackTripChannels.js` — orchestrator (provision + top-up)

**Files:**
- Create: `backend/src/slack/slackTripChannels.js`
- Test: `backend/src/slack/slackTripChannels.test.js`

The behavioral core. Fully dependency-injected (`lf`, `slack`, `store`, `dir`, `overrides`, `config`, `now`) so the test uses fakes — no real Slack/LF/DB.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/slack/slackTripChannels.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provisionNewTrips, topUpMembership } from './slackTripChannels.js';

const NOW = Date.parse('2026-06-23T12:00:00Z');

function makeSlack() {
  const calls = { created: [], invited: [], posted: [] };
  const emailToId = { 'ann@x.com': 'UANN' }; // SIC bob@x.com intentionally unmatched
  return {
    calls,
    async createChannel(name) { const id = `C_${name}`; calls.created.push({ name, id }); return { id, name }; },
    async inviteUsers(channelId, ids) { calls.invited.push({ channelId, ids }); return { invited: ids, failed: [] }; },
    async lookupByEmail(email) { return emailToId[email] || null; },
    async postMessage(channelId, text) { calls.posted.push({ channelId, text }); return true; },
  };
}

const snaps = [{
  departure: { airport: 'KFXE', time: 1765207800000 }, arrival: { airport: 'TJSJ', time: 1765222200000 },
  pilots: [
    { seat: 2, user: { _id: { $oid: 'pic1' }, firstName: 'Ann', email: 'ann@x.com' } },
    { seat: 3, user: { _id: { $oid: 'sic1' }, firstName: 'Bob', email: 'bob@x.com' } },
  ],
}];

function makeStore(seed = {}) {
  const recorded = [];
  const invitedUpdates = [];
  return {
    recorded, invitedUpdates,
    async getProvisionedOids() { return new Set(seed.provisioned || []); },
    async getTripLegSnapshots() { return seed.snaps || snaps; },
    async recordChannels(row) { recorded.push(row); return true; },
    async getUpcomingProvisioned() { return seed.upcoming || []; },
    async updateInvited(oid, ids) { invitedUpdates.push({ oid, ids }); return true; },
  };
}

const dir = { async getUserIndex() { return new Map(); } };
const overrides = { async getOverrideMap() { return new Map(); } };
const config = { opsMembers: ['UOPS'], accountingMembers: ['UACCT'], managementMembers: ['UMGR'] };

test('provisions a new trip: two channels, invites, intro + unmatched note, records row', async () => {
  const slack = makeSlack();
  const store = makeStore();
  const lf = { async listDispatches() { return { dispatches: [{ _id: { $oid: 'disp1' }, tripId: 25104 }] }; } };

  const n = await provisionNewTrips({ lf, slack, store, dir, overrides, config, now: NOW });
  assert.equal(n, 1);

  // Two channels created with the right names.
  assert.deepEqual(slack.calls.created.map((c) => c.name), ['trip-25104', 'trip-25104-acct']);

  // Ops invite = fixed ops group + matched PIC; SIC (bob) unmatched.
  const opsInvite = slack.calls.invited.find((i) => i.channelId === 'C_trip-25104');
  assert.deepEqual(opsInvite.ids.sort(), ['UANN', 'UOPS']);
  const acctInvite = slack.calls.invited.find((i) => i.channelId === 'C_trip-25104-acct');
  assert.deepEqual(acctInvite.ids.sort(), ['UACCT', 'UMGR']);

  // Unmatched note posted to ops naming Bob.
  const note = slack.calls.posted.find((p) => p.channelId === 'C_trip-25104' && /Couldn't auto-add/i.test(p.text));
  assert.ok(note && /Bob/.test(note.text));

  // Recorded with both channel ids and the union of invited ids.
  assert.equal(store.recorded.length, 1);
  assert.equal(store.recorded[0].oid, 'disp1');
  assert.deepEqual(store.recorded[0].invitedSlackIds.sort(), ['UACCT', 'UANN', 'UMGR', 'UOPS']);
});

test('skips trips already provisioned', async () => {
  const slack = makeSlack();
  const store = makeStore({ provisioned: ['disp1'] });
  const lf = { async listDispatches() { return { dispatches: [{ _id: { $oid: 'disp1' }, tripId: 25104 }] }; } };
  const n = await provisionNewTrips({ lf, slack, store, dir, overrides, config, now: NOW });
  assert.equal(n, 0);
  assert.equal(slack.calls.created.length, 0);
});

test('skips quote/unbooked dispatches that have no tripId', async () => {
  const slack = makeSlack();
  const store = makeStore();
  // getDispatchList returns quotes too; an unbooked dispatch has an empty tripId.
  const lf = { async listDispatches() { return { dispatches: [{ _id: { $oid: 'dispQuote' }, tripId: '' }] }; } };
  const n = await provisionNewTrips({ lf, slack, store, dir, overrides, config, now: NOW });
  assert.equal(n, 0);
  assert.equal(slack.calls.created.length, 0);
  assert.equal(store.recorded.length, 0);
});

test('top-up invites newly-assigned crew not already invited', async () => {
  const slack = makeSlack();
  const store = makeStore({
    upcoming: [{ lf_dispatch_oid: 'disp1', ops_channel_id: 'C_trip-25104', invited_slack_ids: ['UOPS'], first_dep_at: null }],
  });
  await topUpMembership({ slack, store, dir, overrides, config, now: NOW });
  const inv = slack.calls.invited.find((i) => i.channelId === 'C_trip-25104');
  assert.deepEqual(inv.ids, ['UANN']);                 // PIC added; UOPS already there; Bob unmatched
  assert.deepEqual(store.invitedUpdates[0].ids.sort(), ['UANN', 'UOPS']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/slack/slackTripChannels.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/slack/slackTripChannels.js
//
// Orchestrates Slack channel provisioning for new LF trips and tops up crew
// membership as crew get assigned. All I/O is injected (lf, slack, store, dir,
// overrides) so this is unit-tested with fakes.
import { channelName } from './channelName.js';
import { resolveMembers } from './resolveMembers.js';
import { crewFromLegSnapshots } from './crewFromLegSnapshots.js';
import { normalizeDispatchList } from './dispatchList.js';

const emailOf = (c, userIndex) => (c.email || userIndex.get(c.oid)?.email || '').toLowerCase() || null;

async function slackIdsForEmails(slack, emails) {
  const map = new Map();
  for (const email of emails) {
    if (!email || map.has(email)) continue;
    map.set(email, await slack.lookupByEmail(email));
  }
  return map;
}

function firstDepFromSnaps(snaps) {
  const t = (snaps || []).map((s) => s?.departure?.time).filter((x) => typeof x === 'number');
  return t.length ? new Date(Math.min(...t)).toISOString() : null;
}

function routeFromSnaps(snaps) {
  const sorted = [...(snaps || [])].filter(Boolean)
    .sort((a, b) => (a?.departure?.time ?? 0) - (b?.departure?.time ?? 0));
  const icaos = [];
  for (const s of sorted) {
    if (s?.departure?.airport && !icaos.length) icaos.push(s.departure.airport);
    if (s?.arrival?.airport) icaos.push(s.arrival.airport);
  }
  return icaos.join(' → ');
}

function opsIntro(d, crew, snaps) {
  const route = routeFromSnaps(snaps);
  const crewLine = crew.length
    ? `Crew: ${crew.map((c) => `${c.role} ${c.name || c.oid}`).join(', ')}`
    : 'Crew will be added as they are assigned.';
  return `✈️ *Trip ${d.tripId || d.oid}*${route ? ` — ${route}` : ''}\nOps channel created. ${crewLine}`;
}

function acctIntro(d) {
  return `💵 *Trip ${d.tripId || d.oid}* — accounting channel created.`;
}

function unmatchedNote(unmatched) {
  const lines = unmatched.map((u) => `• ${u.name || u.email || 'unknown'}`).join('\n');
  return `⚠️ Couldn't auto-add (no Slack match):\n${lines}\nPlease add them manually.`;
}

// Resolve crew -> { inviteIds, unmatched } given current snaps and lookups.
async function resolveCrew({ snaps, fixedGroupIds, slack, dir, overrides, now }) {
  const crew = crewFromLegSnapshots(snaps);
  const userIndex = crew.length ? await dir.getUserIndex(now) : new Map();
  const overrideMap = await overrides.getOverrideMap();
  const emails = crew.map((c) => emailOf(c, userIndex)).filter(Boolean);
  const idForEmail = await slackIdsForEmails(slack, emails);
  const resolved = resolveMembers({
    crew,
    fixedGroupIds,
    dirEmailForOid: (oid) => userIndex.get(oid)?.email || null,
    slackIdForEmail: (e) => idForEmail.get(e) || null,
    overrideForEmail: (e) => overrideMap.get(e) || null,
  });
  return { crew, ...resolved };
}

async function provisionOne({ d, slack, store, dir, overrides, config, now }) {
  const ops = await slack.createChannel(channelName(d.tripId, 'ops'), { isPrivate: true });
  const acct = await slack.createChannel(channelName(d.tripId, 'acct'), { isPrivate: true });
  if (!ops || !acct) throw new Error('channel create failed');

  const snaps = await store.getTripLegSnapshots(d.oid);
  const opsRes = await resolveCrew({ snaps, fixedGroupIds: config.opsMembers, slack, dir, overrides, now });
  const acctRes = resolveMembers({
    crew: [],
    fixedGroupIds: [...config.accountingMembers, ...config.managementMembers],
  });

  await slack.inviteUsers(ops.id, opsRes.inviteIds);
  await slack.inviteUsers(acct.id, acctRes.inviteIds);
  await slack.postMessage(ops.id, opsIntro(d, opsRes.crew, snaps));
  await slack.postMessage(acct.id, acctIntro(d));
  if (opsRes.unmatched.length) await slack.postMessage(ops.id, unmatchedNote(opsRes.unmatched));

  await store.recordChannels({
    oid: d.oid,
    tripId: d.tripId,
    opsChannelId: ops.id,
    acctChannelId: acct.id,
    invitedSlackIds: [...new Set([...opsRes.inviteIds, ...acctRes.inviteIds])],
    firstDepAt: firstDepFromSnaps(snaps),
    status: 'ok',
  });
}

// Detect new dispatches and provision their channels. Returns the count provisioned.
export async function provisionNewTrips({ lf, slack, store, dir, overrides, config, now }) {
  const dispatches = normalizeDispatchList(await lf.listDispatches());
  const provisioned = await store.getProvisionedOids();
  // Only real booked trips get channels. getDispatchList also returns quote/unbooked
  // dispatches, which carry an empty tripId — skip them (they provision once booked
  // and assigned a trip number, at which point they're still "not yet provisioned").
  const fresh = dispatches.filter((d) => d.tripId && !provisioned.has(d.oid));
  for (const d of fresh) {
    try { await provisionOne({ d, slack, store, dir, overrides, config, now }); }
    catch (e) { console.warn('[slack-channels] provision failed', d.oid, e?.message || e); }
  }
  return fresh.length;
}

// Add newly-assigned crew to already-provisioned upcoming trips (invite-only).
export async function topUpMembership({ slack, store, dir, overrides, config, now }) {
  const nowIso = new Date(now).toISOString();
  const rows = await store.getUpcomingProvisioned(nowIso);
  for (const row of rows) {
    try {
      const snaps = await store.getTripLegSnapshots(row.lf_dispatch_oid);
      const { inviteIds } = await resolveCrew({ snaps, fixedGroupIds: [], slack, dir, overrides, now });
      const already = new Set(row.invited_slack_ids || []);
      const toAdd = inviteIds.filter((id) => !already.has(id));
      if (!toAdd.length) continue;
      await slack.inviteUsers(row.ops_channel_id, toAdd);
      await store.updateInvited(row.lf_dispatch_oid, [...already, ...toAdd]);
    } catch (e) { console.warn('[slack-channels] topup failed', row.lf_dispatch_oid, e?.message || e); }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/slack/slackTripChannels.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/slack/slackTripChannels.js backend/src/slack/slackTripChannels.test.js
git commit -m "feat(slack): trip-channel orchestrator (provision + top-up)"
```

---

## Task 11: `slackWatcher.js` + wire into `index.js`

**Files:**
- Create: `backend/src/slack/slackWatcher.js`
- Modify: `backend/src/index.js`

Opt-in worker mirroring `scheduling/syncWorker.js`. Composes the real adapters and runs the orchestrator on an interval. Does nothing unless `SLACK_TRIP_CHANNELS=on` and a bot token is present.

- [ ] **Step 1: Write `slackWatcher.js`**

```js
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
```

- [ ] **Step 2: Wire it into `index.js`**

Add the import next to the other worker imports (after line 20, `import { startSyncWorker } from './scheduling/syncWorker.js';`):

```js
import { startSlackWatcher } from './slack/slackWatcher.js';
```

And call it next to the other `start*()` calls (after `startSyncWorker();`, around line 76):

```js
  startSyncWorker();
  startSlackWatcher();
```

- [ ] **Step 3: Verify the full test suite + clean import**

Run: `node --test backend/src/slack/*.test.js backend/src/services/*.test.js`
Expected: PASS (all slack/* and existing services/* tests green).

Run: `node -e "import('./backend/src/slack/slackWatcher.js').then(()=>console.log('ok'))"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/slack/slackWatcher.js backend/src/index.js
git commit -m "feat(slack): opt-in trip-channel watcher, wired into server boot"
```

---

## Task 12: Rollout & verification checklist

**Files:** none (operational). Do NOT enable in prod until these pass.

This subsystem is dark until `SLACK_TRIP_CHANNELS=on`. Verify in order:

- [ ] **Step 1: Apply migration 018.** Paste `backend/migrations/018_slack_trip_channels.sql` into the Supabase SQL editor and run it. Confirm both tables exist.

- [ ] **Step 2: Create the Slack app + bot token.** Scopes: `groups:write`, `channels:manage`, `chat:write`, `users:read.email`. Install to the workspace; copy the bot token (`xoxb-…`). Invite the bot to the workspace. Set env on Railway: `SLACK_BOT_TOKEN`.

- [ ] **Step 3: Set the fixed-group env vars** on Railway (comma-separated Slack user IDs): `SLACK_OPS_MEMBERS`, `SLACK_ACCOUNTING_MEMBERS`, `SLACK_MANAGEMENT_MEMBERS`. (Claude can help look these up via the connected Slack during dev.)

- [ ] **Step 4: Confirm the LF user email field (structure only — no PII).** Run a one-off that prints only key names, never values:

```bash
node -e "import('./backend/src/services/levelflight.js').then(async m => { const u = await m.getUsers(); const first = (Array.isArray(u)?u:(u.users||u.data||[]))[0]||{}; console.log('user keys:', Object.keys(first)); console.log('has email-ish:', ['email','emailAddress','primaryEmail'].filter(k=>k in first)); });"
```

Expected: an `email`-ish key is listed. If the real key differs, add it to the fallback list in `lfUserDirectory.js` (`indexUsers`) and `crewFromLegSnapshots.js`, then re-run their tests.

- [ ] **Step 5: Confirm `getDispatchList(1)` is newest-first (structure only).**

```bash
node -e "import('./backend/src/services/levelflight.js').then(async m => { const r = await m.getDispatchList(1); const rows = Array.isArray(r)?r:(r.dispatches||r.data||[]); console.log('count:', rows.length, 'top keys:', Object.keys(rows[0]||{})); });"
```

Expected: a non-empty page; confirm the most recently-created dispatches appear on page 1. If not, adjust `slackWatcher.js`'s `listDispatches` to page further (e.g. fetch pages 1–2).

- [ ] **Step 6: Enable and observe.** Set `SLACK_TRIP_CHANNELS=on` (optionally `SLACK_WATCH_INTERVAL_MS=60000`). Redeploy. Create a test trip in LevelFlight. Within ~1 interval, confirm: two private channels (`#trip-<n>`, `#trip-<n>-acct`) appear; fixed groups are present in each; the intro messages posted; a `trip_slack_channels` row was written. Assign a pilot in LF, wait for the 5-min sync + next watcher tick, and confirm they get added to the ops channel.

- [ ] **Step 7: Seed overrides if needed.** For any crew flagged "couldn't auto-add", insert a row into `slack_user_overrides` (`lf_email` lowercased → `slack_user_id`). They'll be added on the next top-up tick.

---

## Self-Review Notes

- **Spec coverage:** dedicated watcher (Tasks 11/3) · two private channels per trip (Tasks 2/10) · ops = pilots+attendants+fixed ops (Tasks 5/6/10) · accounting = fixed accounting+management (Task 10) · no passengers (crew source excludes pax) · email match + override fallback + unmatched flag (Tasks 6/7/9/10) · idempotency via `trip_slack_channels` (Tasks 1/9/10) · membership top-up (Task 10) · soft-fail stores (Task 9) · 429 backoff + name_taken adoption (Task 8) · DI tests (Tasks 2–7, 10) · `getDispatchList` page-1 assumption verified (Task 12 Step 5). All covered.
- **Out of scope (per spec):** channel archiving on completion, crew removal on un-assign, live status updates, passenger channels, override-table UI.
