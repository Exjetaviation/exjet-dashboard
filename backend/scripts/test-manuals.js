#!/usr/bin/env node
// Smoke test for the GOM RAG layer. Runs three representative queries
// through the search_manuals tool path (Voyage embed → pgvector match)
// and prints the top-3 results for each.
//
//   node scripts/test-manuals.js

import 'dotenv/config';
import { executeTool } from '../src/agent/tools/index.js';

const QUERIES = [
  'minimum fuel reserves for IFR',
  'captain duty time limits',
  'MEL deferral procedure',
];

function snippet(s, n = 240) {
  const flat = String(s || '').replace(/\s+/g, ' ').trim();
  return flat.length > n ? flat.slice(0, n) + '…' : flat;
}

async function main() {
  for (const q of QUERIES) {
    console.log(`\n──────────────────────────────────────────────────────`);
    console.log(`Q: ${q}`);
    console.log(`──────────────────────────────────────────────────────`);
    const result = await executeTool('search_manuals', { query: q, top_k: 3 });
    if (result?.error) {
      console.log(`  ERROR: ${result.error}`);
      continue;
    }
    const matches = result?.matches || [];
    if (matches.length === 0) { console.log('  (no matches)'); continue; }
    for (const [i, m] of matches.entries()) {
      const score = m.score != null ? m.score.toFixed(3) : '—';
      const section = m.section || '(no section)';
      const page = m.page != null ? `p.${m.page}` : '(no page)';
      console.log(`\n  ${i + 1}. [${score}] ${m.manual} · ${section} · ${page}`);
      console.log(`     ${snippet(m.content)}`);
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error('FATAL:', e?.message || e);
  process.exit(1);
});
