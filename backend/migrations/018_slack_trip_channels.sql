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
