// HTTP surface for the Operations Copilot agent.
//
//   POST /api/agent/review   — kicks off a readiness review for one flight.
//   POST /api/agent/chat     — multi-turn follow-up; client sends full history.
//
// Both endpoints stream their response as newline-delimited JSON
// (Content-Type: application/x-ndjson). Event types: `iteration`,
// `tool_start`, `tool_complete`, `final`, and `error`. `final` is the last
// event before res.end(); `error` is emitted if the agent throws mid-stream.
//
// Mounted under app.use('/api', requireAuth), so both endpoints inherit the
// Supabase JWT guard from src/middleware/requireAuth.js.

import express from 'express';
import { runAgent } from '../agent/agent.js';
import { getLatestReviewForFlight, listReviewsByContext } from '../agent/reviewStore.js';

const router = express.Router();

// Readiness reviews can run for a minute or two. Keep both sockets open
// well past any default cutoff so the stream isn't severed mid-flight.
const LONG_TIMEOUT_MS = 5 * 60 * 1000;
function holdConnectionOpen(req, res) {
  if (typeof req.setTimeout === 'function') req.setTimeout(LONG_TIMEOUT_MS);
  if (typeof res.setTimeout === 'function') res.setTimeout(LONG_TIMEOUT_MS);
}

// Set the response up for chunk-by-chunk NDJSON delivery: identity encoding
// (no compression), no caching, and a hint to proxies (nginx, etc.) not to
// buffer. flushHeaders so the client sees Content-Type before the first
// event lands.
function openStream(res) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Content-Encoding', 'identity');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

function writeEvent(res, evt) {
  // One JSON object per line.
  res.write(JSON.stringify(evt) + '\n');
  // Express/Node http does not buffer by default; nothing to flush here.
}

function buildReviewKickoff({ tail, departure, destination, departureDate, flightId }) {
  const parts = ['Run a flight readiness review on the following flight.'];
  if (tail) parts.push(`Tail: ${tail}.`);
  if (departure && destination) parts.push(`Route: ${departure} to ${destination}.`);
  if (departureDate) parts.push(`Departure date: ${departureDate}.`);
  if (flightId) parts.push(`ForeFlight flightId (if needed): ${flightId}.`);
  parts.push(
    'Use your tools to locate the matching records and cover the five readiness areas (crew, aircraft compliance, weather, airport/runway suitability, performance) plus airport intelligence where relevant.',
  );
  // The system prompt alone has not been strong enough to bind the tool in
  // practice — the model has produced prose instead. Be explicit here.
  parts.push(
    'This is a structured readiness review. You MUST end by calling the render_review tool, with all six checks populated (id values: crew, compliance, weather, airport_runway, performance, airport_intelligence). Do not reply in plain text — the structured tool call IS the response.',
  );
  return parts.join(' ');
}

// Drive runAgent and stream every event it emits. If runAgent throws after
// the stream is open, emit `error` and end cleanly rather than letting the
// socket dangle. `extra` is merged into runAgent's options so callers can
// pass flightId, persist flags, etc.
async function streamAgent(res, messages, question, extra = {}) {
  openStream(res);
  let finalSent = false;
  try {
    await runAgent(messages, {
      ...extra,
      question,
      onEvent: (evt) => {
        if (evt?.type === 'final') finalSent = true;
        writeEvent(res, evt);
      },
    });
  } catch (err) {
    console.error('agent stream failed:', err);
    if (!finalSent) {
      writeEvent(res, { type: 'error', message: err?.message || 'agent stream failed' });
    }
  } finally {
    res.end();
  }
}

// GET /api/agent/reviews?tail=&departure=&destination=&departureDate=
// Lists previously saved structured reviews matching this flight context,
// most recent first. Used by the panel's tab strip — one tab per past
// review. At least one filter must be present so we don't dump the whole
// table to the client.
router.get('/reviews', async (req, res) => {
  const tail = typeof req.query.tail === 'string' ? req.query.tail : '';
  const departure = typeof req.query.departure === 'string' ? req.query.departure : '';
  const destination = typeof req.query.destination === 'string' ? req.query.destination : '';
  const departureDate = typeof req.query.departureDate === 'string' ? req.query.departureDate : '';
  if (!tail && !(departure && destination) && !departureDate) {
    return res.status(400).json({
      error: 'at least one of { tail }, { departure & destination }, or { departureDate } is required',
    });
  }
  try {
    const reviews = await listReviewsByContext({ tail, departure, destination, departureDate });
    res.json({ reviews });
  } catch (err) {
    console.error('/api/agent/reviews lookup failed:', err);
    res.status(500).json({ error: err?.message || 'lookup failed' });
  }
});

// GET /api/agent/review?flightId=...
// Returns the latest saved structured review for a flightId. Lets the panel
// skip the stream when the user just wants to look at the existing review
// again. 404 when none exists; the client falls back to POST /review.
router.get('/review', async (req, res) => {
  const flightId = typeof req.query.flightId === 'string' ? req.query.flightId : '';
  if (!flightId) {
    return res.status(400).json({ error: 'flightId query parameter is required' });
  }
  try {
    const saved = await getLatestReviewForFlight(flightId);
    if (!saved) return res.status(404).json({ error: 'no saved review for this flight' });
    res.json(saved);
  } catch (err) {
    console.error('/api/agent/review lookup failed:', err);
    res.status(500).json({ error: err?.message || 'lookup failed' });
  }
});

router.post('/review', async (req, res) => {
  holdConnectionOpen(req, res);
  const { tail, departure, destination, departureDate, flightId } = req.body || {};
  if (!tail && !flightId && !(departure && destination)) {
    return res.status(400).json({
      error:
        'review requires at least one of: { tail }, { flightId }, or { departure, destination }',
    });
  }
  const question = buildReviewKickoff({ tail, departure, destination, departureDate, flightId });
  await streamAgent(res, question, question, { flightId: flightId || null });
});

router.post('/chat', async (req, res) => {
  holdConnectionOpen(req, res);
  const { messages, flightId } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'chat requires a non-empty messages array' });
  }
  // Persist the new question against the saved review so the corpus carries
  // the conversation, not just the kickoff.
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const question = typeof lastUser?.content === 'string' ? lastUser.content : '';
  await streamAgent(res, messages, question, { flightId: flightId || null });
});

export default router;
