-- 001_agent_reviews.sql
-- Persistence for Operations Copilot reviews. One row per call to runAgent().
-- The agent must keep working before this migration is run — reviewStore.js
-- fails soft if the table is missing.

create table if not exists public.agent_reviews (
    id           uuid        primary key default gen_random_uuid(),
    created_at   timestamptz not null    default now(),
    question     text,
    final_answer text,
    tool_calls   jsonb       not null    default '[]'::jsonb,
    grounding    jsonb,
    model        text
);

create index if not exists agent_reviews_created_at_idx
    on public.agent_reviews (created_at desc);
