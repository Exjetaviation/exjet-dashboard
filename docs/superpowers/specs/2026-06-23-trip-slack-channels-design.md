# Trip Slack Channels — Design

> Auto-provision Slack channels for every new LevelFlight trip: an **ops/crew chat**
> and a separate **accounting chat**, each pre-populated with the right people.

## Goal

When a new trip (dispatch) is created in LevelFlight, the system should — within
about a minute — create two private Slack channels for that trip and add the people
who belong in each, with no manual step.

- **Ops channel** (`#trip-<tripId>`): the trip's pilots (PIC + SIC), flight
  attendants, and a fixed ops/dispatch group.
- **Accounting channel** (`#trip-<tripId>-acct`): a fixed accounting group plus
  management/owner.

Passengers/clients are **not** added (they are external and not in the workspace).

This is a self-contained subsystem inside the existing `exjet-dashboard` backend; it
runs on the same Railway server and reuses LevelFlight (LF) auth. It is opt-in via a
new env flag and does not change the existing 5-minute scheduling sync.

## Why a dedicated watcher (not the 5-min sync)

The existing `SCHEDULING_SYNC` worker (`runScheduledLegsSync.js`) is heavyweight: each
pass sweeps ~5 months of scheduled legs, maps them, reconciles against the mirror, and
writes trips/legs/crew. Polling *that* faster to react to new trips would be wasteful
and risks LF rate limits.

Instead, detection and mirroring are **decoupled**. A new lightweight watcher polls a
cheap LF endpoint just to spot brand-new trips and provision their channels. The heavy
5-min sync is unchanged.

- Detection call: `getDispatchList(1)` → `POST /api/dispatch/list { page: 1 }` →
  `{ success, message, dispatches, page }`. Page 1 is assumed newest-first.
  **Assumption to verify in implementation:** if the newest trips are not on page 1,
  the watcher pages a little further. Cheap because it's a single request returning a
  page of recent dispatches, not a multi-month leg sweep.

## Architecture

A new subsystem in `backend/`, opt-in via `SLACK_TRIP_CHANNELS=on`, independent of
`SCHEDULING_SYNC`.

- **`backend/src/slack/slackWatcher.js`** — `startSlackWatcher()`: its own
  `setInterval`, default **60s** (`SLACK_WATCH_INTERVAL_MS`). Each tick:
  1. `getDispatchList(1)` → list recent dispatches.
  2. Diff against the `trip_slack_channels` table; any dispatch oid not yet
     provisioned is **new**.
  3. For each new trip: fetch that one dispatch's detail, create channels, add people,
     post intro, record the row.
  4. **Membership top-up:** for already-provisioned trips whose departure is still in
     the future, re-resolve crew and invite anyone newly assigned (crew are often
     assigned *after* a trip is booked). Invite-only; never auto-removes.
- **`backend/src/services/slack.js`** — thin Slack Web API wrapper (a bot token):
  `createChannel`, `inviteUsers`, `lookupUserByEmail`, `postMessage`. Respects 429
  rate limits with backoff.
- **Pure helpers** (no I/O, fully unit-tested):
  - `channelName(tripId, kind)` → `trip-1234` / `trip-1234-acct` (Slack-safe slug).
  - `resolveMembers({ crew, fixedGroups, overrides, lookups })` → `{ inviteIds[],
    unmatched[] }` — turns crew + fixed groups into a deduped list of Slack user IDs
    to invite, plus the crew that couldn't be matched.
  - membership-dedup against `invited_slack_ids` for top-up.

The heavy 5-min sync (`runScheduledLegsSync.js`, `syncWorker.js`) is **not modified**.

## Data flow (per newly-detected trip)

1. Build channel names: `#trip-<tripId>` (ops) and `#trip-<tripId>-acct` (accounting),
   both **private**.
2. `conversations.create` both channels (the bot is a member automatically).
3. Resolve members:
   - **Ops** = pilots (seat 2 PIC, seat 3 SIC) + attendants (seat 7) + fixed ops group.
     Each crew member is matched to a Slack user via `users.lookupByEmail` on their LF
     `user.email`; on miss, fall back to the `slack_user_overrides` table.
   - **Accounting** = fixed accounting group + management/owner (Slack IDs from config).
4. `conversations.invite` the resolved Slack IDs into each channel.
5. Post an intro message to each channel (trip #, route, dates, tail, client, crew),
   built from the trip-sheet data already rendered backend-side.
6. Any crew that couldn't be matched → post a `⚠️ couldn't auto-add: <name>` notice in
   the ops channel so a human adds them manually.
7. Write a `trip_slack_channels` row (the idempotency guard).

### Resolving crew → Slack identity

Each LF crew `user` object carries an `email` (confirmed in
`scheduling/crewAssignment.js`). Primary match is `users.lookupByEmail`. Where a crew
member's Slack email differs from their LF email, an entry in `slack_user_overrides`
(`lf_email` → `slack_user_id`) provides the mapping. Unmatched crew are flagged in the
channel (per decision) rather than silently dropped.

## Data model (Supabase — 2 new tables, manual migration)

Migrations are applied manually in the Supabase SQL editor (project convention). Both
stores **soft-fail** if their table is absent, so a deploy before the migration is
applied does not break the watcher.

- **`trip_slack_channels`** — one row per provisioned trip:
  - `lf_dispatch_oid` (text, **unique**) — the LF dispatch id; the idempotency key.
  - `trip_id` (text) — human trip number.
  - `ops_channel_id`, `acct_channel_id` (text) — Slack channel IDs.
  - `invited_slack_ids` (jsonb) — Slack user IDs already invited (top-up dedup).
  - `status` (text) — `ok` | `error`.
  - `created_at` (timestamptz).
- **`slack_user_overrides`** — manual mapping for mismatched crew:
  - `lf_email` (text) — or LF user oid; the lookup key.
  - `slack_user_id` (text).

A trip present in `trip_slack_channels` is never re-provisioned (channels are created
once); subsequent ticks only top up membership.

## Configuration / prerequisites

Provided by the user / set as env on Railway:

- **`SLACK_BOT_TOKEN`** — a Slack app bot token with scopes: `groups:write` (create &
  manage private channels), `channels:manage`, `chat:write`, `users:read.email`.
- **`SLACK_OPS_MEMBERS`**, **`SLACK_ACCOUNTING_MEMBERS`**, **`SLACK_MANAGEMENT_MEMBERS`**
  — comma-separated Slack user IDs for the fixed groups.
- **`SLACK_TRIP_CHANNELS=on`** — enables the watcher.
- **`SLACK_WATCH_INTERVAL_MS`** — optional, default `60000`.

During development, the user's connected Slack (MCP) can be used to look up the fixed
group user IDs and to test channel creation; the running server uses its own bot token.

## Error handling

- The watcher tick is wrapped so a Slack or LF failure **never throws** out of the
  worker — it logs, records `status='error'` on the trip row (or simply leaves the trip
  unprovisioned), and retries that trip on the next tick (it is still
  absent/incomplete in `trip_slack_channels`).
- Slack 429 rate limits are respected with backoff in `services/slack.js`.
- Invites are idempotent: Slack IDs already in `invited_slack_ids` are skipped, and
  re-inviting an existing member is treated as success.
- Channel-name collisions (a channel of that name already exists) are handled by
  adopting the existing channel rather than failing.

## Testing

`node:test`, with dependency-injected `slack` + `db` + `lf` adapters (same pattern as
`runScheduledLegsSync.js`):

- Pure helpers fully unit-tested: `channelName`, `resolveMembers` (matched, override
  fallback, unmatched flagging, dedup), top-up dedup against `invited_slack_ids`.
- Watcher orchestration tested with fakes — new-trip detection diff, provision-once
  idempotency, membership top-up for future trips — with no real Slack/LF calls.

## Out of scope (v1)

- Archiving/closing channels when a trip completes or cancels.
- Removing crew from a channel when they are unassigned (invite-only).
- Posting live trip updates/status changes after the intro message.
- Adding passengers/clients to any channel.
- A UI for managing the override table (edited directly in Supabase for now).
