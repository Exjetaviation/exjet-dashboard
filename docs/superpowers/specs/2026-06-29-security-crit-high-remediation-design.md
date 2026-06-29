# Security Remediation — Critical/High, Pass 1

**Date:** 2026-06-29
**Status:** Approved design → implementation
**Branch:** `fix/security-crit-high`
**Source:** Read-only security audit of 2026-06-29 (`~/Desktop/exjet-security-audit-2026-06-29.pdf`; 3 Critical / 8 High / 8 Medium / 22 Low / 12 Info).

## 1. Context

The audit found that the otherwise-sound server-side auth model is defeated wholesale by a handful of issues. This pass remediates the **code-fixable Critical and High** findings and produces the **operational deliverables** (a migration + a runbook) for the items that must be executed against Supabase / Railway / git history, which Claude cannot run from here.

In scope (this pass):

| ID | Severity | Title |
|---|---|---|
| C1 | Critical | Finance API exposed unauthenticated via whole-router public mount at `/api/finances/callback` |
| C2 | Critical | Quotes API exposed unauthenticated via whole-router public mount at `/api/quotes/auth-callback` |
| H1 | High | `/api/finances/debug/*` exempted from the auth guard |
| H2 | High | Authorization role read from self-writable `user_metadata.app_role` |
| C3 | Critical | No RLS on Supabase tables (→ migration `024`, applied manually) |
| H3 | High | Supabase service-role key in published git history (→ runbook) |
| I5 | Info  | `NODE_ENV` not pinned to production (→ runbook) |

Out of scope (deferred to pass 2): all remaining Medium/Low/Info (M2–M7, L1–L17, I1–I9). Notably the QB/Gmail OAuth-callback **token-echo** (L8/L9) is *preserved unchanged* by the C1/C2 fixes — narrowing exposure, not changing behavior.

## 2. Code changes

### C1 — Finances router no longer public

**Files:** `backend/src/index.js`, `backend/src/routes/finances.js`

- In `finances.js`: extract the existing `router.get('/callback', …)` body into a named export `financeOauthCallback(req, res)`; remove the in-router `/callback` route.
- In `index.js`: replace `app.use('/api/finances/callback', financesRoutes)` (a whole-router mount, registered *before* the guard) with a single exact-path public handler `app.get('/api/finances/callback', financeOauthCallback)`.
- The guarded `app.use('/api/finances', financesRoutes)` mount is unchanged.

**Why it works:** `app.use(prefix, router)` matches the prefix and routes *every* sub-path of the router; `app.get(exactPath, handler)` matches only that exact path. So `/api/finances/callback/summary` no longer resolves publicly — it falls through to the `/api` guard. The OAuth redirect URI (`/api/finances/callback`) is unchanged, so the QuickBooks flow still works.

**Acceptance:** `/api/finances/callback` (exact) serves the OAuth handler without auth; `/api/finances/callback/summary`, `/api/finances/callback/raw-invoices`, `/api/finances/callback/gl/:x`, etc. return 401 without a token; `/api/finances/summary` still works *with* a valid token.

### C2 — Quotes router no longer public

**Files:** `backend/src/index.js`, `backend/src/routes/quotes.js`

- In `quotes.js`: extract `router.get('/auth-callback', …)` into a named export `gmailOauthCallback(req, res)`; remove the in-router route.
- In `index.js`: replace `app.use('/api/quotes/auth-callback', quotesRoutes)` with `app.get('/api/quotes/auth-callback', gmailOauthCallback)`.
- The guarded `app.use('/api/quotes', quotesRoutes)` mount is unchanged.

**Acceptance:** `/api/quotes/auth-callback` (exact) serves the Gmail OAuth handler without auth; `/api/quotes/auth-callback` sub-paths (`/list`, `/scan`, `/:id`, `/dispatch/:id/send-link`, …) return 401 without a token; the guarded `/api/quotes/*` endpoints still work with a token.

### H1 — Remove the debug auth-bypass

**Files:** `backend/src/index.js`, `backend/src/routes/finances.js`, `frontend/src/pages/Finances.jsx`

- In `index.js`: remove the `if (req.path.startsWith('/finances/debug/')) return next();` exemption so the guard is a plain `app.use('/api', requireAuth)`.
- In `finances.js`: delete `router.get('/debug/expenses')`, `/debug/pl-by-customer`, `/debug/financials` (audit-only; never fetched by the frontend).
- In `Finances.jsx:817`: update the help-text string that references `/api/finances/debug/financials` (route no longer exists).

**Acceptance:** no `/api/**` path is reachable without a valid token; the Finances page renders without referencing a removed route.

### H2 — Role sourced from `app_metadata`

**Files:** `backend/src/middleware/requireAuth.js` (+ a new co-located test)

- Add a pure, exported helper `roleFromUser(user)` returning `user?.app_metadata?.app_role || 'crew'`.
- Use it to set `req.user.role`; stop reading `user_metadata`.
- No frontend change: nothing in `frontend/src` gates UI on `app_role` (verified) — the UI relies on backend 403s. `app_metadata` is readable client-side from the session if ever needed later (it is non-secret, just not client-*writable*).

**Why:** Supabase `user_metadata` (`raw_user_meta_data`) is writable by the user via `supabase.auth.updateUser({ data })`; `app_metadata` is settable only via the service-role Admin API. Reading the role from `app_metadata` closes the browser-console self-promotion path.

**Test (`requireAuth.test.js`, `node:test`):** `roleFromUser` returns `'crew'` when only `user_metadata.app_role` is set (escalation attempt ignored); returns the granted role when `app_metadata.app_role` is set; returns `'crew'` for null/empty users.

**Rollout coupling (critical):** existing role grants live in `user_metadata`. The one-time copy `user_metadata.app_role → app_metadata.app_role` (runbook §3) MUST run **before** this code deploys, or every editor drops to `crew` until re-provisioned.

## 3. Operational deliverables

### `backend/migrations/024_enable_rls.sql` (C3)

Idempotent SQL, applied by hand in the Supabase SQL editor (project convention: no migration runner). For every `public` table:

- `ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;` (RLS-on with no policy = deny-all for non-service roles).
- `REVOKE ALL ON public.<t> FROM anon, authenticated;` (defense in depth).

Tables enumerated from the schema catalog (CLAUDE.md §18) plus the out-of-band tables `rate_cards`, `app_config`, `pricing_history`. The backend uses the **service-role** key, which bypasses RLS — so application behavior is unchanged; only the anon-key PostgREST bypass is closed. The migration `DO`-guards each statement so missing tables don't error.

**Acceptance:** after apply, the Supabase dashboard "RLS disabled" advisories clear for all `public` tables; the app continues to function (service-role unaffected); a direct anon-key `GET /rest/v1/scheduling_people` returns no rows / permission denied.

### `docs/superpowers/specs/security-remediation-runbook.md` (H3, I5, rollout for H2/C3)

Ordered, copy-pasteable steps:

1. **Rotate keys** — rotate the Supabase **service-role** and **anon** keys (treat the historical service key as compromised); update Railway (`SUPABASE_SERVICE_KEY`) and Vercel (`VITE_SUPABASE_ANON_KEY`); redeploy.
2. **Purge git history** — remove `backend/.env` from all history (`git filter-repo --path backend/.env --invert-paths` or BFG), force-push, ask collaborators to re-clone. (Even after rotation, purge to avoid leaking the *structure* and any other historical values.)
3. **Migrate roles to `app_metadata`** — one-time SQL (Supabase SQL editor), run **before** deploying the H2 code:
   `UPDATE auth.users SET raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || jsonb_build_object('app_role', raw_user_meta_data->>'app_role') WHERE raw_user_meta_data ? 'app_role';`
   Going forward, grant roles via the Admin API / dashboard **app_metadata**, not user_metadata.
4. **Apply migration `024`** — paste `024_enable_rls.sql` into the SQL editor; verify advisories clear.
5. **Pin `NODE_ENV`** — set `NODE_ENV=production` on Railway (suppresses Express stack traces; I5).
6. **Verify** — re-run the audit's unauth probes (expect 401): `curl -i <prod>/api/finances/callback/summary`, `curl -i <prod>/api/quotes/auth-callback/list`, `curl -i <prod>/api/finances/debug/financials`; confirm an authenticated editor can still book/price; confirm a `crew` user cannot self-promote.

## 4. Testing & verification

- **Unit:** `roleFromUser` via `node:test` (co-located `requireAuth.test.js`).
- **Static reasoning + manual:** the route-mount changes are verified by reading the final `index.js` (exact-path public handlers; single `requireAuth` guard) and by the curl probes in runbook §6 against a deploy. (Importing `index.js` in a test is impractical — it binds a port and starts the five background workers.)
- **Regression:** run the existing suite — `node --test backend/src/**/*.test.js` and the frontend lib tests — to confirm no breakage. `cd frontend && npm run build` to confirm the `Finances.jsx` edit compiles.

## 5. Delivery

- All work on `fix/security-crit-high`.
- Per project convention: show the **diff + a one-line diagnosis**, then **wait for an explicit "push"** — nothing is pushed unprompted.
- Commits co-authored. Update `CLAUDE.md` where this changes a documented fact (the `/finances/debug/*` exemption note in §12/§16/§19; the auth role-source note in §16; the new migration `024` in §3/§18).

## 6. Risks / notes

- **Lock-out risk (H2):** mitigated by ordering — role-copy SQL before deploy (runbook §3).
- **OAuth breakage risk (C1/C2):** mitigated by preserving the exact redirect-URI paths; only sibling routes are removed from the public surface.
- **RLS over-restriction:** the backend never uses the anon/authenticated roles for data, so enabling RLS cannot break server behavior; the only consumer affected is any *direct* anon-key table access — which is exactly the hole being closed. (Frontend anon-key table reads in the dead `quoteEngine.js` are not in the live path; confirm during pass 2.)
