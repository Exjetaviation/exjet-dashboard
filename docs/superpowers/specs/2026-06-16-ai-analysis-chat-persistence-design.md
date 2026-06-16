# AI Analysis — persist & reload follow-up chat per review

**Date:** 2026-06-16
**Status:** Approved (design)

## Problem

In the AI Analysis side panel (`frontend/src/components/AgentReviewPanel.jsx`),
each structured *review* is persisted to the Supabase `agent_reviews` table and
shown as a tab. But **follow-up chat** ("summarize this tab in layman terms")
is held only in local component state (`replies` / `conversation`). When the
panel closes, that state is lost.

The `/api/agent/chat` endpoint *does* currently write a row per follow-up, but
with `review = null`. The tab list (`listReviewsByContext`) filters those out
(`.not('review','is',null)`), and re-opening a review (`applySavedReview`)
resets `replies: []`. So the chat is unreachable — effectively "didn't save."

## Goal

Each review tab keeps its own follow-up Q&A. Opening that tab reloads the
review **and** every follow-up asked under it, in order. Persistence is
server-side (Supabase) so it survives refresh and is visible across devices.

Non-goal: recovering chats lost before this change (unrecoverable). Fix is
forward-looking.

## Approach (chosen: A — store on the review row)

Store the follow-up conversation as a JSON array on the parent review's row.

### Data model

New migration `backend/migrations/004_agent_reviews_conversation.sql`:

```sql
alter table public.agent_reviews
    add column if not exists conversation jsonb not null default '[]'::jsonb;
```

`conversation` holds the rendered follow-up turns:
`[{ question, text, toolCalls, grounding }]` — the exact shape the panel's
`replies` array already uses. Fails soft until the migration is run, matching
existing migrations.

### Backend (`backend/src/agent/reviewStore.js`, `backend/src/routes/agent.js`)

1. `updateReviewConversation(reviewId, conversation)` — updates the column for
   one row; soft-fails (returns null) when Supabase is off, the id is missing,
   or the update errors. Mirrors the existing soft-fail style.
2. `listReviewsByContext` — add `conversation` to the `select` so each tab
   carries its follow-ups when the panel first loads.
3. New route `POST /api/agent/reviews/:id/conversation` — body
   `{ conversation: [...] }`; validates the array, calls
   `updateReviewConversation`, returns `{ ok: true }` (or soft `{ ok: false }`).
4. `/api/agent/chat` — pass `persist: false` so chat no longer inserts orphan
   `review = null` rows. Chat now lives on its parent review only.

### Frontend (`frontend/src/components/AgentReviewPanel.jsx`)

1. After a follow-up `final` (the `text` branch in `handleEvent`), append to
   `replies` as today, then POST the updated replies to
   `/api/agent/reviews/:id/conversation` for the **active review id**
   (`activeTabId` / `reviewMeta.reviewId`). No id (persistence off) → skip,
   soft.
2. `applySavedReview` / `selectTab` — accept the row's saved `conversation` and
   `setReplies(conversation)`; rebuild the `conversation` (role/content) state
   from kickoff + review summary + the saved follow-ups so chat continuity
   works after reload.
3. Tab objects from the list now include `conversation`; `selectTab` applies it.

## Data flow

ask follow-up → stream answer → render in `replies` → POST replies onto the
review row. Reopen panel / click tab → review + saved follow-ups render
together; conversation state rebuilt for continued chat.

## Edge cases

- Supabase persistence off / `reviewId` null → chat save soft-skips (unchanged
  behavior philosophy).
- Follow-up that returns a *structured* review (not text) still creates its own
  review tab — unchanged.
- Empty/oversized conversation array → route validates type; rejects non-arrays.

## Testing

The backend has no test harness (no runner, zero existing tests). We will not
introduce a framework for this change. Instead:

- A small `node:test` (built-in, no deps) smoke covering the no-config soft-fail
  path of `updateReviewConversation` (returns null with no Supabase env) and the
  route's input validation (non-array body → 400).
- Manual verification in the running app (login-gated): ask a follow-up, close
  the panel, reopen the tab, confirm the follow-up is still shown; refresh the
  page and confirm it persists.

## Files touched

- `backend/migrations/004_agent_reviews_conversation.sql` (new)
- `backend/src/agent/reviewStore.js`
- `backend/src/routes/agent.js`
- `frontend/src/components/AgentReviewPanel.jsx`
