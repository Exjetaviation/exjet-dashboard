#!/usr/bin/env node
// Ingest operational manual PDFs into Supabase pgvector.
//
//   node scripts/ingest-manuals.js                  # all PDFs
//   node scripts/ingest-manuals.js --manual GOM     # only GOM.pdf
//
// Per-PDF flow: read → parse → strip boilerplate → chunk → embed → upsert.
// Re-running is safe: rows for the manual being ingested are deleted
// before the new chunks are inserted.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFParse } from 'pdf-parse';
import { createClient } from '@supabase/supabase-js';
import { embed } from '../src/agent/embeddings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANUALS_DIR = path.resolve(__dirname, '..', 'manuals');

// Chunking parameters — ~500 tokens / ~100 token overlap by char proxy.
const CHUNK_TARGET_CHARS = 2000;
const CHUNK_OVERLAP_CHARS = 400;
// Repeated header/footer cutoff: drop lines appearing on more than this
// fraction of pages. Spec calls for "more than half."
const REPEATED_LINE_THRESHOLD = 0.5;
// Don't bother detecting repeated lines on tiny manuals — they'd
// false-positive on actual content.
const MIN_PAGES_FOR_REPEATED_STRIP = 4;
// Insert batch size — Supabase default rejects huge inserts.
const DB_BATCH = 200;

/* ─────────────── boilerplate strip ─────────────── */

function isPageNumberLine(line) {
  const t = line.trim();
  if (!t) return false;
  // Pure digits, "Page 12", "Page 12 of 99", "- 12 -".
  if (/^\d+$/.test(t)) return true;
  if (/^page\s+\d+(\s*(of|\/)\s*\d+)?$/i.test(t)) return true;
  if (/^-?\s*\d+\s*-?$/.test(t)) return true;
  return false;
}

// Lines that appear (verbatim, after trim) on more than half the pages —
// classic running header/footer signature.
function findRepeatedLines(pages) {
  if (pages.length < MIN_PAGES_FOR_REPEATED_STRIP) return new Set();
  const counts = new Map();
  for (const page of pages) {
    const seen = new Set();
    for (const line of page.text.split('\n')) {
      const t = line.trim();
      if (t.length < 4) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  const minOcc = Math.ceil(pages.length * REPEATED_LINE_THRESHOLD) + 1;
  const repeated = new Set();
  for (const [line, count] of counts.entries()) {
    if (count >= minOcc) repeated.add(line);
  }
  return repeated;
}

// Per-page: list of paragraphs, each tagged with page number. Paragraphs
// are runs of non-blank lines separated by blanks. Boilerplate is dropped
// at the line level so paragraph structure survives.
function pageToParagraphs(page, repeatedLines) {
  const paragraphs = [];
  let buf = [];
  const flush = () => {
    if (buf.length === 0) return;
    paragraphs.push({ page: page.num, text: buf.join('\n').trim() });
    buf = [];
  };
  for (const rawLine of page.text.split('\n')) {
    const isBlank = !rawLine.trim();
    if (isBlank) { flush(); continue; }
    if (isPageNumberLine(rawLine)) continue;
    if (repeatedLines.has(rawLine.trim())) continue;
    buf.push(rawLine);
  }
  flush();
  return paragraphs.filter((p) => p.text.length > 0);
}

/* ─────────────── section detection ─────────────── */

// Best-effort. Returns the heading text if `line` looks like a section
// heading; null otherwise. Two patterns:
//   1) Numbered section: "3.4.2 Some Title" / "3 Some Title".
//   2) ALL-CAPS multi-word line, e.g. "FUEL POLICY".
function detectSection(line) {
  const t = line.trim();
  if (t.length < 4 || t.length > 120) return null;
  if (/^\d+(\.\d+)*\s+[A-Z]/.test(t)) return t;
  if (/^[A-Z][A-Z0-9\s\-&,.()/]+$/.test(t) && /\s/.test(t) && t.length >= 8) return t;
  return null;
}

/* ─────────────── chunking ─────────────── */

// Concatenate paragraphs into chunks. We respect paragraph boundaries
// (never split a paragraph), aim for ~CHUNK_TARGET_CHARS, and carry the
// most recent detected section into each chunk's metadata. Overlap is
// built by replaying the tail paragraphs of the previous chunk into the
// next.
function chunkParagraphs(allParagraphs) {
  const chunks = [];
  let buf = [];
  let bufLen = 0;
  let currentSection = null;

  const emit = () => {
    if (buf.length === 0) return;
    const content = buf.map((p) => p.text).join('\n\n').trim();
    // Pick the "primary" page — the one contributing the most characters
    // to this chunk. Ties go to the earliest.
    const pageBytes = new Map();
    for (const p of buf) {
      pageBytes.set(p.page, (pageBytes.get(p.page) || 0) + p.text.length);
    }
    let bestPage = null, bestBytes = -1;
    for (const [pg, b] of pageBytes.entries()) {
      if (b > bestBytes) { bestPage = pg; bestBytes = b; }
    }
    chunks.push({
      content,
      section: currentSection,
      page_number: bestPage,
      chunk_index: chunks.length,
    });
  };

  for (const para of allParagraphs) {
    // Update current section if the paragraph leads with a heading.
    const firstLine = para.text.split('\n')[0];
    const sect = detectSection(firstLine);
    if (sect) currentSection = sect;

    const willExceed = bufLen + para.text.length + 2 > CHUNK_TARGET_CHARS && buf.length > 0;
    if (willExceed) {
      emit();
      // Build the next chunk's leading overlap from the tail of the
      // emitted one, walking backwards until we hit the overlap budget.
      const overlap = [];
      let overlapLen = 0;
      for (let i = buf.length - 1; i >= 0; i--) {
        const candidate = buf[i].text.length + 2;
        if (overlapLen + candidate > CHUNK_OVERLAP_CHARS && overlap.length > 0) break;
        overlap.unshift(buf[i]);
        overlapLen += candidate;
      }
      buf = overlap;
      bufLen = overlapLen;
    }
    buf.push(para);
    bufLen += para.text.length + 2;
  }
  emit();
  return chunks;
}

/* ─────────────── parsing ─────────────── */

async function parsePdf(filePath) {
  const buf = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buf });
  const result = await parser.getText();
  const pages = Array.isArray(result?.pages) ? result.pages : [];
  // Each page is { num, text }.
  return pages.map((p) => ({ num: p.num, text: typeof p.text === 'string' ? p.text : '' }));
}

/* ─────────────── persistence ─────────────── */

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY must be set');
  return createClient(url, key);
}

async function replaceManual(client, manual_name, chunks, embeddings) {
  // Idempotent: drop existing rows for this manual, then bulk insert.
  const { error: delErr } = await client
    .from('manual_chunks')
    .delete()
    .eq('manual_name', manual_name);
  if (delErr) throw new Error(`delete failed: ${delErr.message}`);

  const rows = chunks.map((c, i) => ({
    manual_name,
    section: c.section,
    page_number: c.page_number,
    chunk_index: c.chunk_index,
    content: c.content,
    // pgvector accepts a JSON array via the JS client.
    embedding: embeddings[i],
  }));

  for (let i = 0; i < rows.length; i += DB_BATCH) {
    const batch = rows.slice(i, i + DB_BATCH);
    const { error } = await client.from('manual_chunks').insert(batch);
    if (error) throw new Error(`insert batch ${i / DB_BATCH} failed: ${error.message}`);
  }
}

/* ─────────────── pipeline ─────────────── */

async function ingestPdf(filePath) {
  const manual_name = path.basename(filePath, path.extname(filePath));
  const pages = await parsePdf(filePath);
  const repeated = findRepeatedLines(pages);
  const paragraphs = pages.flatMap((p) => pageToParagraphs(p, repeated));
  const chunks = chunkParagraphs(paragraphs);

  if (chunks.length === 0) {
    return { manual_name, pages: pages.length, chunks: 0, totalChars: 0, repeatedDropped: repeated.size };
  }

  // Embed in batches (the client itself chunks to 128, so we hand it the
  // full set).
  const embeddings = await embed(chunks.map((c) => c.content), { inputType: 'document' });

  const client = getSupabase();
  await replaceManual(client, manual_name, chunks, embeddings);

  const totalChars = chunks.reduce((n, c) => n + c.content.length, 0);
  return { manual_name, pages: pages.length, chunks: chunks.length, totalChars, repeatedDropped: repeated.size };
}

/* ─────────────── CLI ─────────────── */

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--manual') { out.manual = argv[++i]; continue; }
    if (a === '--help' || a === '-h') { out.help = true; continue; }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/ingest-manuals.js [--manual NAME]');
    process.exit(0);
  }
  if (!fs.existsSync(MANUALS_DIR)) {
    console.error(`manuals directory not found: ${MANUALS_DIR}`);
    process.exit(1);
  }
  const all = fs.readdirSync(MANUALS_DIR).filter((f) => f.toLowerCase().endsWith('.pdf'));
  const selected = args.manual
    ? all.filter((f) => path.basename(f, '.pdf').toLowerCase() === args.manual.toLowerCase())
    : all;
  if (selected.length === 0) {
    console.error(args.manual ? `no PDF matching "${args.manual}" in ${MANUALS_DIR}` : `no PDFs in ${MANUALS_DIR}`);
    process.exit(1);
  }

  const results = [];
  for (const fname of selected) {
    const filePath = path.join(MANUALS_DIR, fname);
    console.log(`\n→ ingesting ${fname} …`);
    try {
      const r = await ingestPdf(filePath);
      results.push(r);
      console.log(`  ✓ ${r.manual_name}: ${r.chunks} chunks across ${r.pages} pages (${r.totalChars.toLocaleString()} chars, dropped ${r.repeatedDropped} repeated header/footer lines)`);
    } catch (e) {
      console.error(`  ✗ ${fname}: ${e?.message || e}`);
      process.exitCode = 1;
    }
  }

  console.log('\n=== summary ===');
  for (const r of results) {
    console.log(`  ${r.manual_name.padEnd(20)} ${String(r.chunks).padStart(4)} chunks  ${String(r.pages).padStart(4)} pages  ${r.totalChars.toLocaleString()} chars`);
  }
}

main().catch((e) => {
  console.error('FATAL:', e?.message || e);
  process.exit(1);
});
