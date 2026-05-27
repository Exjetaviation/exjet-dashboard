-- 002_agent_reviews_flight_lookup.sql
-- Lets the panel skip re-running the agent on every open by looking up the
-- latest saved review for a flight. Adds:
--   flight_id  — ForeFlight flightId (text); null for older rows and for
--                any review kicked off without a flightId in the request.
--   review     — the structured render_review payload as jsonb. Replaces
--                relying on final_answer for the checklist UI.
-- An index on (flight_id, created_at desc) keeps the latest-per-flight
-- lookup cheap.

alter table public.agent_reviews
    add column if not exists flight_id text,
    add column if not exists review    jsonb;

create index if not exists agent_reviews_flight_id_created_at_idx
    on public.agent_reviews (flight_id, created_at desc)
    where flight_id is not null;
