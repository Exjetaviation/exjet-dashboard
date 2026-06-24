# Fuel-Price Email Ingestion — Design

**Date:** 2026-06-24
**Status:** Approved design, pending implementation plan
**Scope:** Automatically ingest weekly fuel-price CSVs that two vendors (World Fuel / WFS,
and Everest) email to `operations@flyexjet.vip`, parse them, and store the prices keyed by
airport + FBO — so they're queryable and ready for a future "true cost per hour" quoting
project.

---

## 1. Context & Goal

Exjet receives weekly contract-fuel price lists as CSV attachments from two vendors, emailed
to **operations@flyexjet.vip**. Today these are uploaded to LevelFlight manually. We want to
**scan that mailbox weekly, extract the CSVs, parse them, and keep an up-to-date fuel-price
table** in our own DB.

**Why:** this is the first variable-cost input for a **future quoting project** that will
collect all variable pricing items and compute a **true cost per hour** for any flight. This
build just lands the prices cleanly and queryably; the FBO-matching and cost math are that
later project.

**Source decision (important):** ForeFlight's Dispatch API was investigated (full swagger
analyzed, 41 endpoints, 104 schemas) and **does NOT expose fuel-by-FBO** — `DTOFBO` is just a
per-flight `{name, phone, email, fax}` contact, and `DTOFlightCost.fuelCost` is a single
computed per-flight number, not per-FBO prices. LevelFlight *does* expose
`/api/airport/fuel/{icao}`, but the user maintains the prices themselves (they upload to LF),
so the chosen source is the **vendor CSVs via email** — we own the data directly.

### In scope
The fuel-price store, the two vendor parsers, the email scan of `operations@`, a weekly
scheduler, a manual trigger, and a read endpoint.

### Out of scope (the future cost-per-hour project)
Matching `fbo_name` to our `airport_fbos` directory; feeding price × fuel-burn into a true
cost/hour; any UI beyond a verification read endpoint.

---

## 2. The two CSV formats (analyzed from real files)

**WFS `WFS FUEL.csv`** — ~4,203 rows, 1,030 airports, quoted CSV. Columns:
`Country/State, City, ICAO, Supplier, Gal From, Gal To, Exp Date, Estimated Price,
Estimated Taxes, Estimated Total Price, Pre- Arr Req, Notes`
- `Supplier` = FBO name. Volume tier is a **range** (`Gal From`→`Gal To`).
- `Exp Date` format `04-Jun-26` (DD-Mon-YY). Has taxes + total price.
- **Fuel type is embedded in `Notes`**: `**Price for fuel item: JET FUEL**` (3,581) or
  `JETA-ADDITIVE` (622) — extract via regex `Price for fuel item:\s*([^*]+)\*`.

**Everest `Everest Fuel_MM_DD_YYYY.csv`** — ~4,485 rows, 2,743 airports, simple CSV. Columns:
`ICAO, FBO, TIER, PRICE, NAME` (+ a trailing empty column).
- `FBO` = FBO name; `NAME` populated ~46% (secondary/brand name → `fbo_alt_name`).
- Volume tier is a **floor** (`TIER` = min gallons: 1, 251, 501, 1001…). One `PRICE`.
- No fuel type (default `JET-A`), no taxes/expiry. **Effective date is in the filename**
  (`_06_23_2026`).

---

## 3. Data Model — one migration

> Migration number: `020` is reserved by the in-flight Slack-channels PR, so use the next
> free number (likely `021`) — confirm at plan time. Applied **manually** in Supabase; stores
> **soft-fail** until applied.

### `fuel_prices`
One row per (vendor, airport, FBO, fuel type, volume tier).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `vendor` | text | `'wfs'` \| `'everest'` |
| `icao` | text | indexed |
| `fbo_name` | text | WFS `Supplier` / Everest `FBO` |
| `fbo_alt_name` | text null | Everest `NAME` |
| `fuel_type` | text | WFS-extracted (`JET FUEL`/`JETA-ADDITIVE`) / Everest `JET-A` |
| `tier_from_gal` | numeric | WFS `Gal From` / Everest `TIER` (min gallons for this price) |
| `tier_to_gal` | numeric null | WFS `Gal To` |
| `price` | numeric | WFS `Estimated Price` / Everest `PRICE` |
| `taxes` | numeric null | WFS `Estimated Taxes` |
| `total_price` | numeric null | WFS `Estimated Total Price` |
| `currency` | text | default `'USD'` |
| `exp_date` | date null | WFS `Exp Date` |
| `city` | text null | WFS |
| `country` | text null | WFS `Country/State` |
| `notes` | text null | WFS `Notes` |
| `import_id` | text | the batch this row belongs to (Gmail message id) |
| `source_file` | text | attachment filename |
| `effective_date` | date | WFS = file/email date; Everest = filename date |
| `imported_at` | timestamptz | default `now()` |

Indexes: `(icao)`, `(icao, fbo_name)`, `(vendor)`.

### `fuel_price_imports` — audit + dedup log
| Column | Type | Notes |
|---|---|---|
| `gmail_message_id` | text pk | dedup key — scan skips ids already logged `ok` |
| `vendor` | text | |
| `file_name` | text | |
| `rows_imported` | int | |
| `effective_date` | date null | |
| `status` | text | `'ok'` \| `'error'` |
| `message` | text null | error detail |
| `imported_at` | timestamptz | default `now()` |

---

## 4. Vendor Parsers (pure, unit-tested)

`backend/src/services/fuel/parsers/wfs.js` and `…/everest.js`, each
`parse(csvText, { sourceFile, importId, effectiveDate }) → normalizedRow[]` where a row
matches the `fuel_prices` columns above (minus `imported_at`). Use a real CSV parser (the WFS
file is quoted with commas inside fields).

- **WFS**: map `Supplier`→`fbo_name`, `Gal From/To`→tiers, parse the three price columns,
  `Exp Date`→date, regex fuel type out of `Notes`, carry city/country/notes. Skip rows with
  no ICAO or no numeric price.
- **Everest**: map `FBO`→`fbo_name`, `NAME`→`fbo_alt_name`, `TIER`→`tier_from_gal`,
  `PRICE`→`price`, `fuel_type='JET-A'`, `effective_date` from the passed filename date. Skip
  blank/last empty column and non-numeric prices.

A small `parsers/index.js` routes by **sender** (primary) then filename:
`everest-fuel.com` / `everest*.csv` → Everest; `wfscorp.com` / `wfs*.csv` → WFS.

---

## 5. Email Scan (reads `operations@`, read-only)

**Auth:** `operations@flyexjet.vip` is a **different Google account** than the one currently
connected (which the quotes scan + sending use via `GMAIL_REFRESH_TOKEN`). Use a **fully
separate, dedicated OAuth app** for it — nothing shared with the existing Gmail credentials
(a single client *can* serve multiple accounts, but a separate app avoids cross-org/admin
consent issues and keeps the fuel integration decoupled from sending + the quotes scan). New
env: `GMAIL_OPS_CLIENT_ID`, `GMAIL_OPS_CLIENT_SECRET`, `GMAIL_OPS_REDIRECT_URI`,
`GMAIL_OPS_REFRESH_TOKEN` (scope: `gmail.readonly` — read-only, we never modify the inbox).
Add a helper `gmailClientFor({ clientId, clientSecret, redirectUri, refreshToken })` that
builds a Gmail client from an explicit config; the existing send/quotes-scan path keeps using
the `GMAIL_*` app untouched. A one-time `scripts/fuelGmailAuth.mjs` mints the refresh token.

**Scan** (`backend/src/services/fuel/fuelMailScan.js` `scanFuelMail()`):
1. Build a gmail client for the ops token. Query **narrowly** so we never touch the rest of
   the ops inbox:
   `from:(fuelmanagement@everest-fuel.com OR fosnda@wfscorp.com) has:attachment newer_than:21d`.
2. For each message **not already in `fuel_price_imports`**: download CSV attachment(s),
   route to the vendor parser (by sender → filename), parse to rows.
3. **Replace that vendor's prices, never leaving an empty window:** insert the new rows tagged
   with `import_id = gmail_message_id`, then delete that vendor's rows with a different
   `import_id`. Log the message id in `fuel_price_imports` (`ok` + row count, or `error` +
   message on a parse/insert failure — a bad file does NOT wipe existing prices).
4. **Read-only on the mailbox** — the scan does NOT mark mail read or modify the inbox; dedup
   is entirely via the import log (safe for a shared ops inbox).

---

## 6. Scheduling + API

- **Weekly worker** (`backend/src/services/fuel/fuelMailWorker.js` `startFuelMailWorker()`),
  opt-in via env (e.g. `FUEL_MAIL_SCAN=on`), mirroring the existing sync workers; runs
  `scanFuelMail()` weekly. Wired in `index.js` next to the other workers.
- **Routes** (`backend/src/routes/fuel.js`, mounted `/api/fuel`, auth-guarded; mutations
  dispatcher-gated):
  - `POST /api/fuel/scan` — run the scan on demand (for setup/verification).
  - `GET /api/fuel/prices?icao=&vendor=` — read prices (verification + the future cost
    project's consumer).
  - `GET /api/fuel/imports` — recent import log (freshness/health view).

---

## 7. Testing

All `node:test`.
- **Parsers** against the **real sample files** (`WFS FUEL.csv`, `Everest Fuel_06_23_2026.csv`
  — copied into a test fixtures dir): expected row counts, fuel-type extraction
  (`JET FUEL`/`JETA-ADDITIVE`), tier parsing, `04-Jun-26`→date, numeric prices, Everest
  filename-date, skipped blank rows.
- **Router**: sender/filename → correct vendor.
- **Replace-per-vendor**: new batch replaces old; a failed batch leaves prior prices intact.
- **Dedup**: a message id already in `fuel_price_imports` is skipped.

---

## 8. Edge Cases & Error Handling

- Stores soft-fail if the migration isn't applied yet (deploy-safe).
- Unknown/zero attachments or an unmatched sender → message skipped + logged (no crash).
- Parse/insert failure for one file → logged `error`, existing prices for that vendor
  retained; other vendors/messages still process.
- Duplicate weekly send (same message reprocessed) → skipped via the import log.
- Never mutates the `operations@` inbox; never prints secrets/PII (fuel prices are business
  data, fine to store; the OAuth token is never logged).

---

## 9. One-Time Setup (user actions)

1. Apply the migration in Supabase.
2. Authorize `operations@`: hit the auth URL (provided), consent **while logged in as
   operations@**, and add the resulting `GMAIL_OPS_REFRESH_TOKEN` to env (local + Railway).
   (Claude never sees the token.)
3. Set `FUEL_MAIL_SCAN=on` to enable the weekly worker (or run `POST /api/fuel/scan` manually).

---

## 10. Open Items (for the future cost-per-hour project)

- Match `fuel_prices.fbo_name` to `airport_fbos` (fuzzy by `(icao, name)` — vendor names
  differ from LF names, e.g. "SIGNATURE FLIGHT SUPPORT OPERATIONS ANTIGUA LTD" vs
  "SIGNATURE AVIATION").
- Combine fuel price × estimated fuel burn (perf profile) into a true cost/hour, alongside
  the other variable cost inputs.
- Decide which WFS price (base vs total-with-taxes) and which tier the cost model uses.
