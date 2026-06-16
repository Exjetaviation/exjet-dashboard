// Soft-failing persistence for agent reviews. If Supabase isn't configured,
// the table doesn't exist, or the network is down, log a warning and return
// null — the agent must keep working before the migration is run.

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

let _client = null;
function getClient() {
  if (_client !== null) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    _client = false; // sentinel for "not configured"
    return null;
  }
  try {
    _client = createClient(url, key);
    return _client;
  } catch (e) {
    console.warn('[reviewStore] failed to construct Supabase client:', e.message);
    _client = false;
    return null;
  }
}

export async function saveReview(record) {
  const client = getClient();
  if (!client) {
    console.warn('[reviewStore] Supabase not configured — skipping persistence');
    return null;
  }
  try {
    const { data, error } = await client
      .from('agent_reviews')
      .insert({
        flight_id: record.flight_id ?? null,
        question: record.question ?? null,
        final_answer: record.final_answer ?? null,
        review: record.review ?? null,
        tool_calls: record.tool_calls ?? [],
        grounding: record.grounding ?? null,
        model: record.model ?? null,
      })
      .select('id')
      .single();
    if (error) {
      console.warn('[reviewStore] insert failed (soft):', error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (e) {
    console.warn('[reviewStore] unexpected error (soft):', e?.message || e);
    return null;
  }
}

// Persist the follow-up conversation for one review row. `conversation` is the
// panel's rendered replies array — [{ question, text, toolCalls, grounding }].
// Soft-fails (returns false) when Supabase is off, the id is missing, or the
// update errors, so a failed save never breaks the live chat.
export async function updateReviewConversation(reviewId, conversation) {
  if (!reviewId || typeof reviewId !== 'string') return false;
  if (!Array.isArray(conversation)) return false;
  const client = getClient();
  if (!client) {
    console.warn('[reviewStore] Supabase not configured — skipping conversation save');
    return false;
  }
  try {
    const { error } = await client
      .from('agent_reviews')
      .update({ conversation })
      .eq('id', reviewId);
    if (error) {
      console.warn('[reviewStore] conversation update failed (soft):', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[reviewStore] conversation update unexpected error (soft):', e?.message || e);
    return false;
  }
}

// List saved reviews whose kickoff `question` matches the given flight
// context (tail + departure ICAO + destination ICAO + departure date).
// We match by substring on the deterministic kickoff template in
// routes/agent.js (buildReviewKickoff). Returns [] on miss or any error.
// The trailing period on each substring matters — without it,
// "Departure date: 2026-05-2" would false-match "2026-05-27".
export async function listReviewsByContext({ tail, departure, destination, departureDate } = {}) {
  const client = getClient();
  if (!client) return [];
  try {
    let q = client
      .from('agent_reviews')
      .select('id, created_at, review, conversation')
      .not('review', 'is', null);
    if (tail)        q = q.ilike('question', `%Tail: ${tail}.%`);
    if (departure && destination) q = q.ilike('question', `%Route: ${departure} to ${destination}.%`);
    if (departureDate) q = q.ilike('question', `%Departure date: ${departureDate}.%`);
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) {
      console.warn('[reviewStore] listReviewsByContext failed (soft):', error.message);
      return [];
    }
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('[reviewStore] listReviewsByContext unexpected error (soft):', e?.message || e);
    return [];
  }
}

// Latest structured review for a given ForeFlight flightId. Returns null
// when none exists, when persistence is off, or on any error. The shape
// matches what the panel needs to render without re-running the agent.
export async function getLatestReviewForFlight(flightId) {
  if (!flightId || typeof flightId !== 'string') return null;
  const client = getClient();
  if (!client) return null;
  try {
    const { data, error } = await client
      .from('agent_reviews')
      .select('id, created_at, review, tool_calls, grounding')
      .eq('flight_id', flightId)
      .not('review', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn('[reviewStore] lookup failed (soft):', error.message);
      return null;
    }
    if (!data) return null;
    return {
      reviewId: data.id,
      savedAt: data.created_at,
      review: data.review,
      toolCalls: data.tool_calls || [],
      grounding: data.grounding || null,
    };
  } catch (e) {
    console.warn('[reviewStore] lookup unexpected error (soft):', e?.message || e);
    return null;
  }
}
