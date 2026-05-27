// The Exjet Operations Copilot agent loop.
// runAgent(messages, options) → { answer, review, toolCalls, grounding, reviewId, ... }
// Loads the system prompt from disk, gives Claude the tool kit, runs the
// tool-use cycle, grounds the answer, persists the review.
//
// Streaming: options.onEvent(evt) is called as the loop runs. Event shapes:
//   { type: 'iteration',    n }
//   { type: 'tool_start',   name, input }
//   { type: 'tool_complete', name, status: 'ok'|'error', ms, error? }
//   { type: 'final',        review|null, text|null, toolCalls, grounding, reviewId }
// The CLI does not pass onEvent — it sees the plain return value as before.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

import { toolSchemas } from './tools/schemas.js';
import { executeTool, RENDER_REVIEW_TOOL } from './tools/index.js';
import { checkGrounding } from './grounding.js';
import { saveReview } from './reviewStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_MODEL = 'claude-opus-4-7';
// 16384 = comfortable headroom for a full six-check render_review payload
// with PDF-derived evidence. max_tokens is a ceiling, not a target — the
// model only spends what it needs.
const DEFAULT_MAX_TOKENS = 16384;
const DEFAULT_MAX_ITERATIONS = 10;

// Load the system prompt once at module load — it's the behavioral contract.
const SYSTEM_PROMPT_PATH = path.join(__dirname, 'system_prompt_dispatch_v1.md');
function loadSystemPrompt() {
  return fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8');
}
const SYSTEM_PROMPT = loadSystemPrompt();

let _client = null;
function getClient() {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  _client = new Anthropic({ apiKey });
  return _client;
}

function normalizeMessages(input) {
  // Accept either a single string (one-shot question) or an array of
  // {role, content} messages (multi-turn).
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }];
  }
  if (!Array.isArray(input)) {
    throw new Error('runAgent: messages must be a string or an array');
  }
  return input.map((m) => ({ role: m.role, content: m.content }));
}

function extractFinalText(message) {
  // Concatenate text blocks from the assistant's final response.
  if (!message || !Array.isArray(message.content)) return '';
  return message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

// Render a captured review as plaintext so the CLI (which prints `answer`)
// still produces useful output. The structured `review` field is the real
// payload for the frontend.
function reviewToPlaintext(review) {
  if (!review || typeof review !== 'object') return '';
  const lines = [];
  if (review.summary) lines.push(review.summary, '');
  if (review.overall_status) lines.push(`Overall: ${review.overall_status}`, '');
  for (const c of review.checks || []) {
    lines.push(`[${c.status || '?'}] ${c.title || c.id} — ${c.headline || ''}`);
  }
  if (Array.isArray(review.global_caveats) && review.global_caveats.length) {
    lines.push('', 'Caveats:');
    for (const cv of review.global_caveats) lines.push(`  - ${cv}`);
  }
  return lines.join('\n').trim();
}

function safeEmit(onEvent, evt) {
  if (typeof onEvent !== 'function') return;
  try { onEvent(evt); } catch (e) { /* never let a bad listener break the loop */ }
}

// Read a header off an SDK error in a Headers-or-object-agnostic way.
function readErrorHeader(err, name) {
  const h = err?.headers;
  if (!h) return null;
  if (typeof h.get === 'function') return h.get(name) ?? h.get(name.toLowerCase()) ?? null;
  return h[name] ?? h[name.toLowerCase()] ?? null;
}

// Build a user-facing error message from an Anthropic SDK exception. 429s
// get a "try again in N min (resets at HH:MM UTC)" line, derived from
// retry-after / anthropic-ratelimit-input-tokens-reset headers. Other
// statuses get a short, plain summary.
function formatApiError(err) {
  const status = err?.status;
  if (status === 429) {
    const retryAfter = readErrorHeader(err, 'retry-after');
    const resetIso = readErrorHeader(err, 'anthropic-ratelimit-input-tokens-reset');
    let when = '';
    let resetAt = '';
    if (resetIso) {
      const t = Date.parse(resetIso);
      if (!Number.isNaN(t)) {
        const min = Math.max(1, Math.round((t - Date.now()) / 60000));
        when = `try again in ${min} min`;
        const d = new Date(t);
        resetAt = `resets at ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
      }
    }
    if (!when && retryAfter) {
      const secs = parseInt(retryAfter, 10);
      if (Number.isFinite(secs)) {
        const min = Math.max(1, Math.round(secs / 60));
        when = `try again in ${min} min`;
      }
    }
    if (!when) when = 'try again in a few minutes';
    return resetAt ? `Rate limit exceeded — ${when} (${resetAt}).` : `Rate limit exceeded — ${when}.`;
  }
  if (status === 401 || status === 403) return 'Agent failed: Anthropic API auth error.';
  if (status === 529) return 'Agent failed: Anthropic API overloaded — try again shortly.';
  return `Agent failed: ${err?.message || String(err)}`;
}

export async function runAgent(messages, options = {}) {
  const client = getClient();
  const model = options.model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS;
  const maxIterations = options.maxIterations || DEFAULT_MAX_ITERATIONS;
  const persist = options.persist !== false;
  const onEvent = options.onEvent;

  const conversation = normalizeMessages(messages);
  const toolCalls = []; // { name, input, result } in execution order
  let finalAnswer = '';
  let capturedReview = null; // input of render_review when the model calls it
  let stopReason = null;
  let iterations = 0;

  // Prompt caching: mark cache breakpoints on the stable parts of every
  // request so iterations 2..N read tools + system from the 5-min
  // ephemeral cache instead of re-paying input tokens for both. The
  // messages array changes every iteration and is NOT cached.
  const system = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
  ];
  const tools = toolSchemas.map((t, i, arr) =>
    i === arr.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t,
  );

  while (iterations < maxIterations) {
    iterations += 1;
    safeEmit(onEvent, { type: 'iteration', n: iterations });

    let response;
    try {
      response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        tools,
        messages: conversation,
      });
    } catch (e) {
      const msg = formatApiError(e);
      console.error(`[agent] API error on iter ${iterations}:`, msg, e?.status ? `(status ${e.status})` : '');
      if (typeof onEvent === 'function') {
        // Streaming path: emit a clean error event and end the loop
        // without a final. The route forwards the event and closes the
        // NDJSON stream; the panel shows the message verbatim.
        safeEmit(onEvent, { type: 'error', message: msg });
        return {
          answer: '', review: null, toolCalls,
          grounding: null, reviewId: null, stopReason: null, iterations,
          error: msg,
        };
      }
      // Non-streaming path (CLI / direct callers): re-throw with the
      // friendly message so the caller's try/catch surfaces it.
      const wrapped = new Error(msg);
      wrapped.cause = e;
      throw wrapped;
    }

    // Cheap, telemetry-only log. Spec: confirm cache_creation on iter 1
    // and cache_read on iter 2..N.
    const u = response.usage || {};
    console.log(
      `[agent] iter=${iterations} in=${u.input_tokens || 0} out=${u.output_tokens || 0} ` +
      `cache_create=${u.cache_creation_input_tokens || 0} cache_read=${u.cache_read_input_tokens || 0}`,
    );

    stopReason = response.stop_reason;

    // Always append the assistant's turn before deciding what to do next.
    conversation.push({ role: 'assistant', content: response.content });

    const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');

    // render_review is terminal — capture it first, regardless of
    // stop_reason. The model may have emitted a complete render_review
    // block even when the response also hit max_tokens (the JSON was
    // finished before the cap; whatever else it wanted to say got cut).
    const renderBlock = toolUseBlocks.find((b) => b.name === RENDER_REVIEW_TOOL);
    if (renderBlock) {
      capturedReview = renderBlock.input || null;
      toolCalls.push({
        name: RENDER_REVIEW_TOOL,
        input: renderBlock.input || {},
        result: { ok: true },
      });
      break;
    }

    // max_tokens cutoff with no render_review and no usable text — the
    // model ran past the output cap before producing anything we can show
    // the user. Emit a specific error (same dual-path pattern as 429),
    // never fall through to a final event with empty fields.
    if (response.stop_reason === 'max_tokens') {
      const text = extractFinalText(response);
      if (!text) {
        const msg = 'Response exceeded the output limit — the review was unusually long. Please retry.';
        console.error(`[agent] max_tokens cutoff on iter ${iterations} with no usable response.`);
        if (typeof onEvent === 'function') {
          safeEmit(onEvent, { type: 'error', message: msg });
          return {
            answer: '', review: null, toolCalls,
            grounding: null, reviewId: null, stopReason: 'max_tokens', iterations,
            error: msg,
          };
        }
        const wrapped = new Error(msg);
        throw wrapped;
      }
      finalAnswer = text;
      break;
    }

    if (response.stop_reason !== 'tool_use') {
      finalAnswer = extractFinalText(response);
      break;
    }

    // Execute every (real) tool_use block in this turn and feed results back.
    const toolResultBlocks = [];
    for (const block of toolUseBlocks) {
      safeEmit(onEvent, { type: 'tool_start', name: block.name, input: block.input || {} });
      const t0 = Date.now();
      const result = await executeTool(block.name, block.input || {});
      const ms = Date.now() - t0;
      const isError = !!(result && typeof result === 'object' && result.error);
      safeEmit(onEvent, {
        type: 'tool_complete',
        name: block.name,
        status: isError ? 'error' : 'ok',
        ms,
        ...(isError ? { error: String(result.error) } : {}),
      });
      toolCalls.push({ name: block.name, input: block.input || {}, result });
      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
        is_error: isError,
      });
    }
    conversation.push({ role: 'user', content: toolResultBlocks });
  }

  if (!finalAnswer && !capturedReview && iterations >= maxIterations) {
    finalAnswer = '[agent stopped: hit max iterations without a final answer]';
  }

  // Keep ask.js useful: if we captured a structured review, surface a
  // plaintext rendering as `answer`. The `review` field carries the real
  // structured payload for the frontend.
  if (capturedReview && !finalAnswer) {
    finalAnswer = reviewToPlaintext(capturedReview);
  }

  const grounding = checkGrounding(finalAnswer, toolCalls, {
    authorizedSources: [SYSTEM_PROMPT],
  });

  let reviewId = null;
  if (persist) {
    const firstUserMessage = conversation.find((m) => m.role === 'user' && typeof m.content === 'string');
    const question =
      typeof options.question === 'string'
        ? options.question
        : firstUserMessage
          ? firstUserMessage.content
          : '';
    reviewId = await saveReview({
      flight_id: options.flightId ?? null,
      question,
      final_answer: finalAnswer,
      review: capturedReview,
      tool_calls: toolCalls,
      grounding,
      model,
    });
  }

  safeEmit(onEvent, {
    type: 'final',
    review: capturedReview,
    text: capturedReview ? null : (finalAnswer || ''),
    toolCalls,
    grounding,
    reviewId,
  });

  return {
    answer: finalAnswer,
    review: capturedReview,
    toolCalls,
    grounding,
    reviewId,
    stopReason,
    iterations,
  };
}
