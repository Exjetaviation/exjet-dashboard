# Fuel-Price Email Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scan `operations@flyexjet.vip` weekly for the WFS and Everest fuel-price CSV attachments, parse each vendor's format, and store the prices in a `fuel_prices` table keyed by airport + FBO.

**Architecture:** Two **pure parsers** (WFS, Everest) normalize each vendor's CSV into a common row shape and are unit-tested against representative fixtures. A **store** writes rows with replace-per-vendor semantics + a dedup/audit log. A **mail scan** reads the ops mailbox (its own OAuth refresh token; narrow query by the two vendor senders; read-only, dedup via the log), routes each attachment to the right parser, and stores. A **weekly worker** (opt-in env) + a **manual route** drive it.

**Tech Stack:** Node + Express, Supabase (PostgREST), **papaparse** (already a dependency) for CSV, `googleapis` (existing Gmail integration), `node:test`.

**Conventions (from CLAUDE.md):** Migrations applied **manually** in Supabase — after writing it, ask the user to run it. Stores **soft-fail** if a table is absent. Never print `.env` values or the OAuth token. Backend tests run from `backend/`: `node --test src/services/fuel/*.test.js`.

**Key facts (verified):** CSV lib = **papaparse** (`import Papa from 'papaparse'`). Migration `020` is taken by the Slack PR → **use `021`**. Gmail client is built in `gmail.js` via `getOAuthClient()` (uses `GMAIL_REFRESH_TOKEN`); we add `gmailClientFor(refreshToken)` for the ops account. Worker wiring mirrors `startSyncWorker` in `index.js`. Role gate = `canEditScheduling(req.user?.role)` from `scheduling/canEdit.js`.

---

## File Structure

**Create:**
- `backend/migrations/021_fuel_prices.sql` — `fuel_prices` + `fuel_price_imports`.
- `backend/src/services/fuel/parseWfs.js` (+ `.test.js`) — pure WFS parser.
- `backend/src/services/fuel/parseEverest.js` (+ `.test.js`) — pure Everest parser.
- `backend/src/services/fuel/routeVendor.js` (+ `.test.js`) — sender/filename → vendor + parser.
- `backend/src/services/fuel/fuelStore.js` — Supabase writes (replace-per-vendor) + reads + import log.
- `backend/src/services/fuel/fuelMailScan.js` — orchestrates the scan.
- `backend/src/services/fuel/fuelMailWorker.js` — weekly opt-in worker.
- `backend/src/routes/fuel.js` — `/api/fuel` routes.

**Modify:**
- `backend/src/services/gmail.js` — add exported `gmailClientFor(refreshToken)`.
- `backend/src/index.js` — mount `/api/fuel`, start the worker.

**Normalized row shape** (produced by both parsers, consumed by the store):
```js
{
  vendor,            // 'wfs' | 'everest'
  icao,              // uppercase
  fbo_name,          // vendor's FBO/Supplier name (raw)
  fbo_alt_name,      // Everest NAME, else null
  fuel_type,         // 'JET FUEL' | 'JETA-ADDITIVE' (WFS) | 'JET-A' (Everest)
  tier_from_gal,     // number — min gallons for this price
  tier_to_gal,       // number | null — WFS Gal To
  price,             // number
  taxes,             // number | null — WFS
  total_price,       // number | null — WFS
  currency,          // 'USD'
  exp_date,          // 'YYYY-MM-DD' | null — WFS Exp Date
  city,              // WFS | null
  country,           // WFS | null
  notes,             // WFS | null
  source_file,       // attachment filename
  effective_date,    // 'YYYY-MM-DD' — Everest from filename, WFS from email date
}
```
(`import_id` + `imported_at` are added by the store, not the parser.)

---

## Task 1: Migration 021 (fuel tables)

**Files:** Create `backend/migrations/021_fuel_prices.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 021_fuel_prices.sql — vendor fuel-price ingestion (WFS + Everest CSVs).
-- Apply manually in the Supabase SQL editor. Idempotent.

CREATE TABLE IF NOT EXISTS fuel_prices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor         text NOT NULL,            -- 'wfs' | 'everest'
  icao           text NOT NULL,
  fbo_name       text,
  fbo_alt_name   text,
  fuel_type      text,
  tier_from_gal  numeric,
  tier_to_gal    numeric,
  price          numeric,
  taxes          numeric,
  total_price    numeric,
  currency       text DEFAULT 'USD',
  exp_date       date,
  city           text,
  country        text,
  notes          text,
  import_id      text,                     -- the gmail message id this batch came from
  source_file    text,
  effective_date date,
  imported_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fuel_prices_icao_idx     ON fuel_prices (icao);
CREATE INDEX IF NOT EXISTS fuel_prices_icao_fbo_idx ON fuel_prices (icao, fbo_name);
CREATE INDEX IF NOT EXISTS fuel_prices_vendor_idx   ON fuel_prices (vendor);

CREATE TABLE IF NOT EXISTS fuel_price_imports (
  gmail_message_id text PRIMARY KEY,
  vendor           text,
  file_name        text,
  rows_imported    int,
  effective_date   date,
  status           text,                   -- 'ok' | 'error'
  message          text,
  imported_at      timestamptz DEFAULT now()
);
```

- [ ] **Step 2: Verify it parses**

Run: `grep -c "CREATE TABLE IF NOT EXISTS" backend/migrations/021_fuel_prices.sql`
Expected: `2`

- [ ] **Step 3: Ask the user to apply it** in the Supabase SQL editor (stores soft-fail until then).

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/021_fuel_prices.sql
git commit -m "feat(db): migration 021 — fuel_prices + fuel_price_imports"
```

---

## Task 2: WFS parser (pure, TDD)

**Files:** Create `backend/src/services/fuel/parseWfs.js` + `backend/src/services/fuel/parseWfs.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWfs } from './parseWfs.js';

const CSV = `"Country/State","City","ICAO","Supplier","Gal From","Gal To","Exp Date","Estimated Price","Estimated Taxes","Estimated Total Price","Pre- Arr Req","Notes"
"Florida","FORT LAUDERDALE","KFXE","BANYAN AIR SERVICE","1","999999999","04-Jun-26","7.10","0.50","7.60",,"misc **Price for fuel item: JET FUEL**/contact fuel24@wfscorp.com"
"Florida","FORT LAUDERDALE","KFXE","BANYAN AIR SERVICE","1","999999999","04-Jun-26","7.30","0","7.30",,"**Price for fuel item: JETA-ADDITIVE**/note"
"Bad","Row","","NO ICAO","1","2","04-Jun-26","x","0","x",,"skip: no icao, no numeric price"`;

test('parseWfs maps columns, extracts fuel type, parses date, skips bad rows', () => {
  const rows = parseWfs(CSV, { sourceFile: 'WFS FUEL.csv', effectiveDate: '2026-06-23' });
  assert.equal(rows.length, 2);
  const a = rows[0];
  assert.equal(a.vendor, 'wfs');
  assert.equal(a.icao, 'KFXE');
  assert.equal(a.fbo_name, 'BANYAN AIR SERVICE');
  assert.equal(a.fuel_type, 'JET FUEL');
  assert.equal(a.tier_from_gal, 1);
  assert.equal(a.tier_to_gal, 999999999);
  assert.equal(a.price, 7.1);
  assert.equal(a.taxes, 0.5);
  assert.equal(a.total_price, 7.6);
  assert.equal(a.exp_date, '2026-06-04');
  assert.equal(a.country, 'Florida');
  assert.equal(a.effective_date, '2026-06-23');
  assert.equal(rows[1].fuel_type, 'JETA-ADDITIVE');
});
```

- [ ] **Step 2: Run it — FAIL**
Run: `cd backend && node --test src/services/fuel/parseWfs.test.js`
Expected: `Cannot find module './parseWfs.js'`.

- [ ] **Step 3: Implement**

```js
import Papa from 'papaparse';

const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
// WFS dates look like "04-Jun-26" → "2026-06-04".
const parseWfsDate = (s) => {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/.exec((s || '').trim());
  if (!m || !MONTHS[m[2]]) return null;
  return `20${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, '0')}`;
};
const num = (v) => { const n = Number(String(v ?? '').trim()); return Number.isFinite(n) ? n : null; };
// Fuel type is embedded in the Notes free text: "**Price for fuel item: JET FUEL**".
const fuelType = (notes) => {
  const m = /Price for fuel item:\s*([^*]+?)\s*\*/i.exec(notes || '');
  return m ? m[1].trim() : null;
};

// Parse a WFS fuel CSV into normalized rows. effectiveDate = the email's received date
// (WFS files carry no date in the name).
export const parseWfs = (csvText, { sourceFile = null, effectiveDate = null } = {}) => {
  const { data } = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  const out = [];
  for (const r of data) {
    const icao = (r.ICAO || '').trim().toUpperCase();
    const price = num(r['Estimated Price']);
    if (!icao || price == null) continue; // skip rows without an airport or a usable price
    out.push({
      vendor: 'wfs',
      icao,
      fbo_name: (r.Supplier || '').trim() || null,
      fbo_alt_name: null,
      fuel_type: fuelType(r.Notes),
      tier_from_gal: num(r['Gal From']),
      tier_to_gal: num(r['Gal To']),
      price,
      taxes: num(r['Estimated Taxes']),
      total_price: num(r['Estimated Total Price']),
      currency: 'USD',
      exp_date: parseWfsDate(r['Exp Date']),
      city: (r.City || '').trim() || null,
      country: (r['Country/State'] || '').trim() || null,
      notes: (r.Notes || '').trim() || null,
      source_file: sourceFile,
      effective_date: effectiveDate,
    });
  }
  return out;
};
```

- [ ] **Step 4: Run it — PASS**
Run: `cd backend && node --test src/services/fuel/parseWfs.test.js`

- [ ] **Step 5: (manual, optional) Sanity-check against the real file** — if `/Users/santiagotorres/Downloads/WFS FUEL.csv` exists:
Run: `cd backend && node --input-type=module -e "import {readFileSync} from 'fs'; import {parseWfs} from './src/services/fuel/parseWfs.js'; const r=parseWfs(readFileSync('/Users/santiagotorres/Downloads/WFS FUEL.csv','utf8'),{}); console.log('rows:',r.length,'| sample:',r[0]?.icao,r[0]?.fbo_name,r[0]?.fuel_type,r[0]?.price);"`
Expected: a few thousand rows; sample shows ICAO + supplier + JET FUEL/JETA-ADDITIVE + a numeric price.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/fuel/parseWfs.js backend/src/services/fuel/parseWfs.test.js
git commit -m "feat(fuel): WFS fuel-CSV parser"
```

---

## Task 3: Everest parser (pure, TDD)

**Files:** Create `backend/src/services/fuel/parseEverest.js` + `backend/src/services/fuel/parseEverest.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEverest, everestDateFromFilename } from './parseEverest.js';

const CSV = `ICAO,FBO,TIER,PRICE,NAME,
07FA,OCEAN REEF CLUB,1,5.79000,,
9TE2,THE JL BAR RANCH,1,7.18729,BRAND X,
9TE2,THE JL BAR RANCH,251,7.08729,BRAND X,
,EMPTY ICAO,1,1.00,,`;

test('everestDateFromFilename extracts MM_DD_YYYY', () => {
  assert.equal(everestDateFromFilename('Everest Fuel_06_23_2026.csv'), '2026-06-23');
  assert.equal(everestDateFromFilename('nope.csv'), null);
});

test('parseEverest maps columns, tier floor, alt name, skips blank icao', () => {
  const rows = parseEverest(CSV, { sourceFile: 'Everest Fuel_06_23_2026.csv', effectiveDate: '2026-06-23' });
  assert.equal(rows.length, 3);
  const a = rows[0];
  assert.equal(a.vendor, 'everest');
  assert.equal(a.icao, '07FA');
  assert.equal(a.fbo_name, 'OCEAN REEF CLUB');
  assert.equal(a.fuel_type, 'JET-A');
  assert.equal(a.tier_from_gal, 1);
  assert.equal(a.tier_to_gal, null);
  assert.equal(a.price, 5.79);
  assert.equal(a.effective_date, '2026-06-23');
  assert.equal(rows[1].fbo_alt_name, 'BRAND X');
  assert.equal(rows[2].tier_from_gal, 251);
});
```

- [ ] **Step 2: Run it — FAIL**
Run: `cd backend && node --test src/services/fuel/parseEverest.test.js`

- [ ] **Step 3: Implement**

```js
import Papa from 'papaparse';

const num = (v) => { const n = Number(String(v ?? '').trim()); return Number.isFinite(n) ? n : null; };

// Everest files carry the price date in the FILENAME: "Everest Fuel_06_23_2026.csv".
export const everestDateFromFilename = (name) => {
  const m = /(\d{2})_(\d{2})_(\d{4})/.exec(name || '');
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
};

// Parse an Everest fuel CSV into normalized rows. TIER is the min-gallons floor for the price.
export const parseEverest = (csvText, { sourceFile = null, effectiveDate = null } = {}) => {
  const { data } = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  const out = [];
  for (const r of data) {
    const icao = (r.ICAO || '').trim().toUpperCase();
    const price = num(r.PRICE);
    if (!icao || price == null) continue;
    out.push({
      vendor: 'everest',
      icao,
      fbo_name: (r.FBO || '').trim() || null,
      fbo_alt_name: (r.NAME || '').trim() || null,
      fuel_type: 'JET-A',
      tier_from_gal: num(r.TIER),
      tier_to_gal: null,
      price,
      taxes: null,
      total_price: null,
      currency: 'USD',
      exp_date: null,
      city: null,
      country: null,
      notes: null,
      source_file: sourceFile,
      effective_date: effectiveDate,
    });
  }
  return out;
};
```

- [ ] **Step 4: Run it — PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/fuel/parseEverest.js backend/src/services/fuel/parseEverest.test.js
git commit -m "feat(fuel): Everest fuel-CSV parser"
```

---

## Task 4: Vendor router (pure, TDD)

**Files:** Create `backend/src/services/fuel/routeVendor.js` + `backend/src/services/fuel/routeVendor.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vendorFor } from './routeVendor.js';

test('vendorFor: by sender domain (primary)', () => {
  assert.equal(vendorFor({ from: 'Everest <fuelmanagement@everest-fuel.com>', filename: 'x.csv' }), 'everest');
  assert.equal(vendorFor({ from: 'WFS <fosnda@wfscorp.com>', filename: 'x.csv' }), 'wfs');
});
test('vendorFor: falls back to filename', () => {
  assert.equal(vendorFor({ from: 'unknown@x.com', filename: 'WFS FUEL.csv' }), 'wfs');
  assert.equal(vendorFor({ from: 'unknown@x.com', filename: 'Everest Fuel_06_23_2026.csv' }), 'everest');
});
test('vendorFor: unknown → null', () => {
  assert.equal(vendorFor({ from: 'a@b.com', filename: 'random.csv' }), null);
});
```

- [ ] **Step 2: Run it — FAIL**
Run: `cd backend && node --test src/services/fuel/routeVendor.test.js`

- [ ] **Step 3: Implement**

```js
// Identify the fuel vendor from an email's sender (primary) or attachment filename.
export const vendorFor = ({ from = '', filename = '' } = {}) => {
  const f = `${from}`.toLowerCase();
  if (f.includes('everest-fuel.com')) return 'everest';
  if (f.includes('wfscorp.com')) return 'wfs';
  const n = `${filename}`.toLowerCase();
  if (n.includes('everest')) return 'everest';
  if (n.includes('wfs')) return 'wfs';
  return null;
};
```

- [ ] **Step 4: Run it — PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/fuel/routeVendor.js backend/src/services/fuel/routeVendor.test.js
git commit -m "feat(fuel): vendor router by sender/filename"
```

---

## Task 5: Fuel store (Supabase: replace-per-vendor + log + reads)

**Files:** Create `backend/src/services/fuel/fuelStore.js`

This is I/O (Supabase) — verified by import smoke + manual; no unit test.

- [ ] **Step 1: Implement**

```js
import { supabase } from '../supabase.js';

// True if we've already processed this gmail message (ok). Dedup so weekly re-sends and
// re-runs don't reprocess. Soft-fails to false if the table is absent.
export const alreadyImported = async (messageId) => {
  const { data, error } = await supabase
    .from('fuel_price_imports').select('gmail_message_id, status').eq('gmail_message_id', messageId).maybeSingle();
  if (error) return false;
  return data?.status === 'ok';
};

// Record an import attempt (ok or error). Upsert so a retry overwrites a prior error.
export const logImport = async (row) => {
  await supabase.from('fuel_price_imports').upsert(row, { onConflict: 'gmail_message_id' });
};

// Replace a vendor's prices with a fresh batch, never leaving an empty window: insert the
// new rows tagged with import_id, then delete that vendor's rows from older imports.
export const replaceVendorPrices = async (vendor, importId, rows) => {
  if (!rows.length) return { inserted: 0 };
  const tagged = rows.map((r) => ({ ...r, import_id: importId }));
  // Insert in chunks (PostgREST payload limits).
  for (let i = 0; i < tagged.length; i += 1000) {
    const { error } = await supabase.from('fuel_prices').insert(tagged.slice(i, i + 1000));
    if (error) throw error;
  }
  const { error: delErr } = await supabase
    .from('fuel_prices').delete().eq('vendor', vendor).neq('import_id', importId);
  if (delErr) throw delErr;
  return { inserted: tagged.length };
};

// Read prices for verification / the future cost project.
export const getFuelPrices = async ({ icao, vendor } = {}) => {
  let q = supabase.from('fuel_prices').select('*');
  if (icao) q = q.eq('icao', icao.trim().toUpperCase());
  if (vendor) q = q.eq('vendor', vendor);
  const { data, error } = await q.limit(500);
  if (error) return [];
  return data || [];
};

export const getImports = async () => {
  const { data, error } = await supabase
    .from('fuel_price_imports').select('*').order('imported_at', { ascending: false }).limit(50);
  if (error) return [];
  return data || [];
};
```

- [ ] **Step 2: Import smoke**
Run: `cd backend && node --input-type=module -e "import('./src/services/fuel/fuelStore.js').then(()=>console.log('IMPORT_OK')).catch(e=>{console.error(e.message);process.exit(1)})"`
Expected: `IMPORT_OK`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/fuel/fuelStore.js
git commit -m "feat(fuel): fuel-price store (replace-per-vendor + import log + reads)"
```

---

## Task 6: Gmail client-for-token helper

**Files:** Modify `backend/src/services/gmail.js`

`gmail.js` has an internal `getOAuthClient()` that hardcodes `GMAIL_REFRESH_TOKEN` (line 5-13). Add an exported builder that accepts any refresh token, so the fuel scan can use the ops account without disturbing the existing send/quotes paths.

- [ ] **Step 1: Add the export** (after `getGmail`, ~line 15):

```js
// Build a Gmail API client for a specific account's refresh token (same OAuth app).
// Used by the fuel scan to read operations@ via GMAIL_OPS_REFRESH_TOKEN.
export const gmailClientFor = (refreshToken) => {
  const client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
  client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: client });
};
```

- [ ] **Step 2: Import smoke**
Run: `cd backend && node --input-type=module -e "import('./src/services/gmail.js').then(m=>console.log('IMPORT_OK', typeof m.gmailClientFor)).catch(e=>{console.error(e.message);process.exit(1)})"`
Expected: `IMPORT_OK function`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/gmail.js
git commit -m "feat(gmail): gmailClientFor(refreshToken) for a second account"
```

---

## Task 7: Mail scan orchestrator

**Files:** Create `backend/src/services/fuel/fuelMailScan.js`

Orchestration over Gmail + parsers + store. I/O-heavy → import smoke + manual verification.

- [ ] **Step 1: Implement**

```js
import { gmailClientFor } from '../gmail.js';
import { parseWfs } from './parseWfs.js';
import { parseEverest, everestDateFromFilename } from './parseEverest.js';
import { vendorFor } from './routeVendor.js';
import { alreadyImported, logImport, replaceVendorPrices } from './fuelStore.js';

const PARSERS = { wfs: parseWfs, everest: parseEverest };
// Narrow query: only the two vendors' messages with attachments, recent window.
const QUERY = 'from:(fuelmanagement@everest-fuel.com OR fosnda@wfscorp.com) has:attachment newer_than:21d';

const headerVal = (headers, name) => (headers || []).find((h) => h.name?.toLowerCase() === name)?.value || '';

// Walk a message payload for CSV attachments → [{ filename, attachmentId }].
const csvAttachments = (payload) => {
  const out = [];
  const walk = (p) => {
    if (!p) return;
    const fn = p.filename || '';
    if (fn.toLowerCase().endsWith('.csv') && p.body?.attachmentId) out.push({ filename: fn, attachmentId: p.body.attachmentId });
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  return out;
};

// Scan operations@ for new vendor fuel CSVs and store them. Read-only on the mailbox
// (dedup via fuel_price_imports — never marks mail read). Returns a summary.
export async function scanFuelMail() {
  const token = process.env.GMAIL_OPS_REFRESH_TOKEN;
  if (!token) return { ok: false, error: 'GMAIL_OPS_REFRESH_TOKEN not set' };
  const gmail = gmailClientFor(token);
  const list = await gmail.users.messages.list({ userId: 'me', q: QUERY, maxResults: 25 });
  const messages = list.data.messages || [];
  const results = [];

  for (const { id } of messages) {
    if (await alreadyImported(id)) { results.push({ id, skipped: 'already imported' }); continue; }
    try {
      const detail = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      const from = headerVal(detail.data.payload?.headers, 'from');
      const internalMs = Number(detail.data.internalDate) || Date.now();
      const emailDate = new Date(internalMs).toISOString().slice(0, 10);
      const atts = csvAttachments(detail.data.payload);
      if (!atts.length) { await logImport({ gmail_message_id: id, status: 'error', message: 'no csv attachment' }); results.push({ id, error: 'no csv' }); continue; }

      let totalRows = 0, vendor = null, fileName = null, effDate = null;
      for (const att of atts) {
        vendor = vendorFor({ from, filename: att.filename });
        if (!vendor) { continue; }
        const a = await gmail.users.messages.attachments.get({ userId: 'me', messageId: id, id: att.attachmentId });
        const csv = Buffer.from(a.data.data, 'base64').toString('utf8');
        effDate = vendor === 'everest' ? (everestDateFromFilename(att.filename) || emailDate) : emailDate;
        const rows = PARSERS[vendor](csv, { sourceFile: att.filename, effectiveDate: effDate });
        if (rows.length) { await replaceVendorPrices(vendor, id, rows); totalRows += rows.length; fileName = att.filename; }
      }
      if (!vendor || !totalRows) { await logImport({ gmail_message_id: id, status: 'error', message: 'no matching vendor / 0 rows' }); results.push({ id, error: 'no vendor/rows' }); continue; }
      await logImport({ gmail_message_id: id, vendor, file_name: fileName, rows_imported: totalRows, effective_date: effDate, status: 'ok' });
      results.push({ id, vendor, rows: totalRows });
    } catch (e) {
      await logImport({ gmail_message_id: id, status: 'error', message: e.message });
      results.push({ id, error: e.message });
    }
  }
  return { ok: true, scanned: messages.length, results };
}
```

- [ ] **Step 2: Import smoke**
Run: `cd backend && node --input-type=module -e "import('./src/services/fuel/fuelMailScan.js').then(()=>console.log('IMPORT_OK')).catch(e=>{console.error(e.message);process.exit(1)})"`
Expected: `IMPORT_OK`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/fuel/fuelMailScan.js
git commit -m "feat(fuel): operations@ mail scan → parse → store"
```

---

## Task 8: Worker + routes + wiring

**Files:** Create `backend/src/services/fuel/fuelMailWorker.js`, `backend/src/routes/fuel.js`; Modify `backend/src/index.js`

- [ ] **Step 1: Worker** (`fuelMailWorker.js`) — opt-in, weekly, mirrors `startSyncWorker`:

```js
import { scanFuelMail } from './fuelMailScan.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
let started = false;

// Opt-in via FUEL_MAIL_SCAN=on. Runs the fuel mail scan on boot + weekly.
export function startFuelMailWorker() {
  if (started || process.env.FUEL_MAIL_SCAN !== 'on') return;
  started = true;
  const run = () => scanFuelMail().then((r) => console.log('[fuelMail]', JSON.stringify(r).slice(0, 300))).catch((e) => console.warn('[fuelMail]', e.message));
  run();
  setInterval(run, WEEK_MS);
}
```

- [ ] **Step 2: Routes** (`routes/fuel.js`):

```js
import express from 'express';
import { scanFuelMail } from '../services/fuel/fuelMailScan.js';
import { getFuelPrices, getImports } from '../services/fuel/fuelStore.js';
import { canEditScheduling } from '../scheduling/canEdit.js';

const router = express.Router();
const requireEditor = (req, res, next) =>
  canEditScheduling(req.user?.role) ? next() : res.status(403).json({ error: 'requires a dispatcher / scheduler role' });

// POST /api/fuel/scan — run the mailbox scan on demand (setup/verification).
router.post('/scan', requireEditor, async (req, res) => {
  try { res.json(await scanFuelMail()); }
  catch (e) { console.error('POST /api/fuel/scan:', e.message); res.status(500).json({ error: 'scan failed' }); }
});

// GET /api/fuel/prices?icao=&vendor= — read stored prices.
router.get('/prices', async (req, res) => {
  res.json({ prices: await getFuelPrices({ icao: req.query.icao, vendor: req.query.vendor }) });
});

// GET /api/fuel/imports — recent import log (freshness/health).
router.get('/imports', async (req, res) => {
  res.json({ imports: await getImports() });
});

export default router;
```

- [ ] **Step 3: Wire into `index.js`** — add the import near the other route imports:
```js
import fuelRoutes from './routes/fuel.js';
```
the worker import near the other worker imports:
```js
import { startFuelMailWorker } from './services/fuel/fuelMailWorker.js';
```
mount the route with the other auth-guarded `/api/*` routes (e.g. after `app.use('/api/quotes', quotesRoutes);`):
```js
app.use('/api/fuel', fuelRoutes);
```
and start the worker where the other workers start (next to `startSyncWorker()` in the `app.listen` callback):
```js
startFuelMailWorker();
```

- [ ] **Step 4: Import smoke + wiring check + full suite** (do NOT import `index.js` — it boots the server)
Run: `cd backend && node --input-type=module -e "import('./src/routes/fuel.js').then(()=>console.log('OK route')).catch(e=>{console.error(e.message);process.exit(1)})"` → `OK route`.
Run: `cd backend && node --input-type=module -e "import('./src/services/fuel/fuelMailWorker.js').then(m=>console.log('OK worker', typeof m.startFuelMailWorker)).catch(e=>{console.error(e.message);process.exit(1)})"` → `OK worker function`.
Run: `cd backend && grep -c "fuelRoutes\|startFuelMailWorker\|/api/fuel" src/index.js` → at least `3` (import + mount + worker wired; `node --check src/index.js` also passes).
Run: `cd backend && node --test src/services/fuel/*.test.js` → 0 fail.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/fuel/fuelMailWorker.js backend/src/routes/fuel.js backend/src/index.js
git commit -m "feat(fuel): weekly worker + /api/fuel routes, wired into index"
```

---

## Definition of Done

- Migration `021` written + applied by the user.
- `node --test src/services/fuel/*.test.js` passes (WFS parser, Everest parser + filename date, vendor router).
- All new modules import cleanly (`IMPORT_OK`).
- Optional real-file sanity check (Task 2 Step 5) shows the WFS parser handling the full file.
- After the user authorizes `operations@` (sets `GMAIL_OPS_REFRESH_TOKEN`) + applies the migration: `POST /api/fuel/scan` ingests the latest WFS + Everest emails; `GET /api/fuel/prices?icao=KFXE` returns prices; `GET /api/fuel/imports` shows the log.

## One-Time Setup (user)

1. Apply `021_fuel_prices.sql` in Supabase.
2. Authorize `operations@`: hit the auth URL (we'll provide via the existing OAuth flow) while logged in as operations@, then add `GMAIL_OPS_REFRESH_TOKEN` to env (local + Railway). Claude never sees the token.
3. Set `FUEL_MAIL_SCAN=on` to enable the weekly worker (or just call `POST /api/fuel/scan`).

## Notes for the future cost-per-hour project
- `getFuelPrices({ icao })` is the consumer entry point. Matching `fbo_name` to `airport_fbos` (fuzzy by `(icao, name)`) and price × fuel-burn → cost/hour are that project.
