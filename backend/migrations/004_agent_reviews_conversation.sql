-- 004_agent_reviews_conversation.sql
-- Persist the follow-up chat ("Ask a follow-up about this flight") alongside
-- the structured review it belongs to, so re-opening a review tab reloads the
-- conversation instead of dropping it. Each element is a rendered follow-up
-- turn: { question, text, toolCalls, grounding }. reviewStore.js fails soft if
-- this column is missing, so the agent keeps working before the migration runs.

alter table public.agent_reviews
    add column if not exists conversation jsonb not null default '[]'::jsonb;
