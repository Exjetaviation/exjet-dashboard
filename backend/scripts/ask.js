#!/usr/bin/env node
// CLI harness for the Operations Copilot agent.
//
//   One-shot:     node scripts/ask.js "is N408JS ready for its next flight?"
//   Interactive:  node scripts/ask.js
//                 (REPL — conversation persists across turns; "exit" / Ctrl-D quits)

import 'dotenv/config';
import readline from 'node:readline';
import { runAgent } from '../src/agent/agent.js';

function summarizeToolCall(c) {
  const isErr = c.result && typeof c.result === 'object' && c.result.error;
  const status = isErr ? '✗' : '✓';
  const input = (() => {
    try { return JSON.stringify(c.input); } catch { return '?'; }
  })();
  const trimmedInput = input.length > 80 ? input.slice(0, 77) + '...' : input;
  return `  ${status} ${c.name}  ${trimmedInput}${isErr ? '  → ' + c.result.error : ''}`;
}

function formatGrounding(g) {
  if (!g) return '  (no grounding info)';
  if (g.grounded) {
    const counts = `${g.checked.tails.length} tail(s), ${g.checked.icaos.length} ICAO(s)`;
    return `  ✓ all verified — ${counts}`;
  }
  const items = g.unverified.map((u) => `${u.value} (${u.type})`).join(', ');
  return `  ⚠ unverified identifiers: ${items}`;
}

function printResult(result) {
  console.log('\n--- Answer ---\n');
  console.log(result.answer || '(no answer)');
  console.log('\n--- Tool calls ---');
  if (result.toolCalls.length === 0) console.log('  (none)');
  else for (const c of result.toolCalls) console.log(summarizeToolCall(c));
  console.log('\n--- Grounding ---');
  console.log(formatGrounding(result.grounding));
  console.log(
    `\n[iters: ${result.iterations} · stop: ${result.stopReason} · reviewId: ${result.reviewId ?? '(not saved)'}]\n`,
  );
}

async function oneShot(question) {
  const result = await runAgent(question, { question });
  printResult(result);
}

async function repl() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const conversation = []; // accumulates {role, content} so multi-turn works
  console.log('Exjet Operations Copilot — interactive mode');
  console.log('Type your question. "exit" or Ctrl-D to quit.\n');

  const ask = () => {
    rl.question('you> ', async (line) => {
      const text = line.trim();
      if (!text) return ask();
      if (text === 'exit' || text === 'quit') { rl.close(); return; }

      conversation.push({ role: 'user', content: text });
      try {
        const result = await runAgent(conversation, { question: text });
        printResult(result);
        // Carry the model's final answer forward as a plain assistant turn so
        // subsequent questions have continuity without dragging the full
        // tool_use / tool_result block trail.
        if (result.answer) {
          conversation.push({ role: 'assistant', content: result.answer });
        }
      } catch (e) {
        console.error('agent error:', e?.message || e);
      }
      ask();
    });
  };
  rl.on('close', () => { console.log('\nbye.'); process.exit(0); });
  ask();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    await repl();
  } else {
    await oneShot(args.join(' '));
  }
}

main().catch((e) => {
  console.error('FATAL:', e?.message || e);
  process.exit(1);
});
