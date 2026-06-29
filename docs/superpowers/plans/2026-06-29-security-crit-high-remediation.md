# Security Critical/High Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the audit's code-fixable Critical/High holes — two unauthenticated whole-router mounts (C1/C2), the debug auth-bypass (H1), and the self-writable-role escalation (H2) — and ship the operational deliverables (RLS migration + runbook) for C3/H3/I5.

**Architecture:** OAuth callbacks become single exact-path public routes instead of whole-router mounts, so only the redirect endpoint is unauthenticated. The auth guard becomes an unconditional `app.use('/api', requireAuth)`. The authorization role is read from `app_metadata` (service-role-only) via a pure, unit-tested helper. RLS + grant revocation ship as a manually-applied migration; key rotation / history purge / `NODE_ENV` / role re-provisioning ship as a runbook.

**Tech Stack:** Node ≥20 ESM, Express, `@supabase/supabase-js`, `node:test`, React 19 + Vite (frontend), Supabase Postgres (SQL migrations applied by hand).

**Branch:** `fix/security-crit-high` (already created). Per project convention: show diffs + a one-line diagnosis and **wait for an explicit "push"** — never push unprompted.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `backend/src/middleware/role.js` | create | Pure `roleFromUser(user)` — the only authority for `req.user.role` (H2) |
| `backend/src/middleware/role.test.js` | create | `node:test` proving `user_metadata` is ignored (H2) |
| `backend/src/middleware/requireAuth.js` | modify | Use `roleFromUser`; stop reading `user_metadata` (H2) |
| `backend/src/scheduling/canEdit.js` | modify | Refresh stale comment (role source) |
| `backend/src/routes/scheduling.js` | modify | Refresh stale comment (role source) |
| `backend/src/routes/finances.js` | modify | Export `financeOauthCallback`; remove in-router `/callback` + the 3 `/debug/*` routes (C1/H1) |
| `backend/src/routes/quotes.js` | modify | Export `gmailOauthCallback`; remove in-router `/auth-callback` (C2) |
| `frontend/src/pages/Finances.jsx` | modify | Drop help-text referencing the removed `/debug/financials` (H1) |
| `backend/src/index.js` | modify | Single exact-path public OAuth routes; unconditional `/api` guard (C1/C2/H1) |
| `backend/migrations/024_enable_rls.sql` | create | Enable RLS + revoke anon/authenticated grants on all public tables (C3) |
| `docs/superpowers/specs/2026-06-29-security-remediation-runbook.md` | create | Ordered operational steps (H3, C3 rollout, H2 role migration, I5) |
| `CLAUDE.md` | modify | Keep §3/§12/§16/§18/§19 current |

---

## Task 1: H2 — role from `app_metadata` (pure helper, TDD)

**Files:**
- Create: `backend/src/middleware/role.js`
- Test: `backend/src/middleware/role.test.js`
- Modify: `backend/src/middleware/requireAuth.js`, `backend/src/scheduling/canEdit.js`, `backend/src/routes/scheduling.js`

- [ ] **Step 1: Write the failing test**

Create `backend/src/middleware/role.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { roleFromUser } from './role.js';

test('roleFromUser ignores self-writable user_metadata (H2)', () => {
  // An attacker can set user_metadata via supabase.auth.updateUser — it must NOT grant a role.
  const user = { app_metadata: {}, user_metadata: { app_role: 'admin' } };
  assert.equal(roleFromUser(user), 'crew');
});

test('roleFromUser reads app_metadata.app_role', () => {
  const user = { app_metadata: { app_role: 'dispatcher' }, user_metadata: {} };
  assert.equal(roleFromUser(user), 'dispatcher');
});

test('roleFromUser defaults to crew for null/empty users', () => {
  assert.equal(roleFromUser(null), 'crew');
  assert.equal(roleFromUser({}), 'crew');
  assert.equal(roleFromUser({ app_metadata: {} }), 'crew');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/santiagotorres/Developer/exjet-dashboard/backend && node --test src/middleware/role.test.js`
Expected: FAIL — `Cannot find module './role.js'`.

- [ ] **Step 3: Create the pure helper**

Create `backend/src/middleware/role.js`:

```js
// Pure authorization-role resolver. The role comes from app_metadata.app_role,
// which is settable ONLY via the Supabase service-role Admin API — never from
// user_metadata, which a logged-in user can write themselves via
// supabase.auth.updateUser({ data }) (audit finding H2). Kept dependency-free so
// it is unit-testable without constructing a Supabase client.
export function roleFromUser(user) {
  return user?.app_metadata?.app_role || 'crew';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/santiagotorres/Developer/exjet-dashboard/backend && node --test src/middleware/role.test.js`
Expected: PASS — 3 tests, 0 failures.

- [ ] **Step 5: Wire `requireAuth` to use it**

In `backend/src/middleware/requireAuth.js`, add the import after the existing imports (top of file):

```js
import { roleFromUser } from './role.js';
```

Replace the `req.user` assignment block:

```js
    req.user = {
      id: data.user.id,
      email: data.user.email,
      role: data.user.user_metadata?.app_role || 'crew',
    };
```

with:

```js
    req.user = {
      id: data.user.id,
      email: data.user.email,
      role: roleFromUser(data.user),
    };
```

- [ ] **Step 6: Refresh the two stale comments**

In `backend/src/scheduling/canEdit.js`, replace the comment lines:

```js
// Authorization for the mutating scheduling routes. requireAuth sets
// req.user.role from the Supabase user_metadata.app_role (defaulting to 'crew'
// when unset). Only the roles below may create/edit scheduling data — assign one
// of these as a user's app_role in Supabase to grant scheduling-edit access.
```

with:

```js
// Authorization for the mutating scheduling routes. requireAuth sets
// req.user.role from the Supabase app_metadata.app_role (defaulting to 'crew'
// when unset). app_metadata is service-role-only (Admin API), NOT the
// user-writable user_metadata (audit H2). Only the roles below may create/edit
// scheduling data — set one of these as a user's app_metadata.app_role to grant
// scheduling-edit access.
```

In `backend/src/routes/scheduling.js`, replace:

```js
// authenticated user). req.user.role comes from requireAuth (Supabase app_role).
```

with:

```js
// authenticated user). req.user.role comes from requireAuth (app_metadata.app_role).
```

- [ ] **Step 7: Re-run the helper test + verify nothing else broke**

Run: `cd /Users/santiagotorres/Developer/exjet-dashboard/backend && node --test src/middleware/role.test.js src/middleware/requireFlightInfoAccess.test.js`
Expected: PASS (role tests + the existing flight-info access tests).

- [ ] **Step 8: Commit**

```bash
cd /Users/santiagotorres/Developer/exjet-dashboard
git add backend/src/middleware/role.js backend/src/middleware/role.test.js backend/src/middleware/requireAuth.js backend/src/scheduling/canEdit.js backend/src/routes/scheduling.js
git commit -m "$(printf 'fix(security/H2): source role from app_metadata, not user_metadata\n\nuser_metadata is writable by the user via supabase.auth.updateUser, so\nany logged-in crew user could self-promote to admin. Read the role from\napp_metadata (service-role-only) via a pure, unit-tested roleFromUser\nhelper. Refresh stale role-source comments.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 2: C1 + H1 — finances handler extraction & debug-route removal

**Files:**
- Modify: `backend/src/routes/finances.js`
- Modify: `frontend/src/pages/Finances.jsx`

- [ ] **Step 1: Extract the OAuth callback as a named export**

In `backend/src/routes/finances.js`, replace the in-router route:

```js
router.get('/callback', async (req, res) => {
  try {
    const tokens = await getTokensFromCode(
      `https://exjet-dashboard-production.up.railway.app/api/finances/callback${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`
    );
    res.json({ message: 'Copy these to your Railway variables', QB_REFRESH_TOKEN: tokens.refresh_token, QB_REALM_ID: req.query.realmId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
```

with a named export (no in-router registration — it is mounted as a single public exact-path route in index.js):

```js
// QuickBooks OAuth redirect target. Mounted as a single PUBLIC exact-path route
// in index.js (Intuit cannot send a login token). It must NOT be part of the
// guarded finances router's surface — see audit finding C1. Behavior unchanged.
export async function financeOauthCallback(req, res) {
  try {
    const tokens = await getTokensFromCode(
      `https://exjet-dashboard-production.up.railway.app/api/finances/callback${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`
    );
    res.json({ message: 'Copy these to your Railway variables', QB_REFRESH_TOKEN: tokens.refresh_token, QB_REALM_ID: req.query.realmId });
  } catch (err) { res.status(500).json({ error: err.message }); }
}
```

- [ ] **Step 2: Delete the three debug routes (H1)**

In `backend/src/routes/finances.js`, delete the entire block from the comment above `/debug/expenses` through the end of the `/debug/financials` handler — i.e. remove `router.get('/debug/expenses', …)`, `router.get('/debug/pl-by-customer', …)`, and `router.get('/debug/financials', …)` and their leading comment blocks. (These are audit-only and never fetched by the frontend.) The next surviving route is `router.get('/summary', …)`.

- [ ] **Step 3: Remove the now-dead help-text in the frontend (H1)**

In `frontend/src/pages/Finances.jsx`, replace:

```jsx
                P&amp;L by Class hasn't come back from QuickBooks yet. If this persists, check the debug dump at <code>/api/finances/debug/financials</code>.
```

with:

```jsx
                P&amp;L by Class hasn't come back from QuickBooks yet. If this persists, check the QuickBooks connection on the Finances admin.
```

- [ ] **Step 4: Verify syntax + frontend build**

Run: `cd /Users/santiagotorres/Developer/exjet-dashboard && node --check backend/src/routes/finances.js && echo OK-BACKEND`
Expected: `OK-BACKEND` (no syntax error; export is valid ESM).
Run: `cd /Users/santiagotorres/Developer/exjet-dashboard/frontend && npm run build`
Expected: Vite build succeeds (`dist/` written, exit 0).

- [ ] **Step 5: Commit**

```bash
cd /Users/santiagotorres/Developer/exjet-dashboard
git add backend/src/routes/finances.js frontend/src/pages/Finances.jsx
git commit -m "$(printf 'fix(security/C1,H1): extract QB OAuth callback; remove debug routes\n\nExport financeOauthCallback for a single public exact-path mount (done\nin index.js) instead of exposing the whole finances router. Delete the\nthree unauthenticated /debug/* dumps and the frontend help-text that\npointed at them.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 3: C2 — quotes handler extraction

**Files:**
- Modify: `backend/src/routes/quotes.js`

- [ ] **Step 1: Extract the OAuth callback as a named export**

In `backend/src/routes/quotes.js`, replace the in-router route:

```js
router.get('/auth-callback', async (req, res) => {
  try {
    const tokens = await getTokensFromCode(req.query.code);
    res.json({ tokens, message: 'Copy the refresh_token to your .env as GMAIL_REFRESH_TOKEN' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

with a named export:

```js
// Gmail OAuth redirect target. Mounted as a single PUBLIC exact-path route in
// index.js (Google cannot send a login token). It must NOT be part of the
// guarded quotes router's surface — see audit finding C2. Behavior unchanged.
export async function gmailOauthCallback(req, res) {
  try {
    const tokens = await getTokensFromCode(req.query.code);
    res.json({ tokens, message: 'Copy the refresh_token to your .env as GMAIL_REFRESH_TOKEN' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
```

- [ ] **Step 2: Verify syntax**

Run: `cd /Users/santiagotorres/Developer/exjet-dashboard && node --check backend/src/routes/quotes.js && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
cd /Users/santiagotorres/Developer/exjet-dashboard
git add backend/src/routes/quotes.js
git commit -m "$(printf 'fix(security/C2): extract Gmail OAuth callback as named export\n\nFor a single public exact-path mount in index.js instead of exposing\nthe whole quotes router (read/modify/delete/send-link) unauthenticated.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 4: C1 + C2 + H1 — rewire `index.js` mounts & guard

**Files:**
- Modify: `backend/src/index.js`

- [ ] **Step 1: Import the named OAuth handlers**

In `backend/src/index.js`, replace the two import lines:

```js
import quotesRoutes from './routes/quotes.js';
import financesRoutes from './routes/finances.js';
```

with:

```js
import quotesRoutes, { gmailOauthCallback } from './routes/quotes.js';
import financesRoutes, { financeOauthCallback } from './routes/finances.js';
```

- [ ] **Step 2: Replace the whole-router public mounts with single exact-path routes**

Replace:

```js
// OAuth callbacks are hit by Google / Intuit, not the browser, so they
// cannot send a login token. They stay outside the auth guard.
app.use('/api/finances/callback', financesRoutes);
app.use('/api/quotes/auth-callback', quotesRoutes);
```

with:

```js
// OAuth redirect callbacks are hit by Intuit / Google, not the browser, so they
// cannot send a login token. ONLY these two exact paths are public — using
// app.get (exact match) instead of app.use (prefix mount) so sibling finance /
// quote routes are NOT exposed (audit findings C1, C2).
app.get('/api/finances/callback', financeOauthCallback);
app.get('/api/quotes/auth-callback', gmailOauthCallback);
```

- [ ] **Step 3: Make the `/api` guard unconditional (H1)**

Replace:

```js
// Everything below this line REQUIRES a valid login token — EXCEPT temporary
// /finances/debug/* endpoints, so they can be opened directly in a browser.
// TODO: remove this exemption when the debug routes are deleted.
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/finances/debug/')) return next();
  return requireAuth(req, res, next);
});
```

with:

```js
// Everything below this line REQUIRES a valid login token. No exemptions.
app.use('/api', requireAuth);
```

- [ ] **Step 4: Verify the module parses (without booting it)**

Run: `cd /Users/santiagotorres/Developer/exjet-dashboard && node --check backend/src/index.js && echo OK`
Expected: `OK`. (We use `node --check`, not run, because `index.js` binds a port and starts the five background workers on import.)

- [ ] **Step 5: Confirm the public surface by reading the result**

Run: `grep -nE "app\.(get|use)\('/api" backend/src/index.js`
Expected: exactly two `app.get('/api/finances/callback'…` and `app.get('/api/quotes/auth-callback'…` lines appear BEFORE a single `app.use('/api', requireAuth)` line; every other `app.use('/api/...', …Routes)` appears AFTER it.

- [ ] **Step 6: Commit**

```bash
cd /Users/santiagotorres/Developer/exjet-dashboard
git add backend/src/index.js
git commit -m "$(printf 'fix(security/C1,C2,H1): narrow public OAuth routes; unconditional /api guard\n\nMount the QB/Gmail OAuth callbacks as single exact-path public routes\ninstead of whole-router prefix mounts, and drop the /finances/debug/*\nauth exemption so all /api/* requires a valid token.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 5: C3 — RLS enablement migration (manual-apply deliverable)

**Files:**
- Create: `backend/migrations/024_enable_rls.sql`

- [ ] **Step 1: Write the migration**

Create `backend/migrations/024_enable_rls.sql`:

```sql
-- 024_enable_rls.sql
-- Audit finding C3: no table had Row-Level Security, so the public anon key
-- (shipped in the frontend bundle) could read/write every table via PostgREST.
-- The backend uses the SERVICE-ROLE key (BYPASSRLS) for all data access, so
-- enabling RLS + revoking anon/authenticated grants changes NOTHING for the app
-- and closes the anon bypass. The live frontend uses the anon key only for
-- Supabase Auth (login), which does not touch public tables.
--
-- Idempotent. Apply MANUALLY in the Supabase SQL editor (project convention:
-- no migration runner). Re-running is safe.

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT format('%I.%I', schemaname, tablename)
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY;', t);
    -- No policies are defined, so RLS = deny-all for non-BYPASSRLS roles.
    EXECUTE format('REVOKE ALL ON TABLE %s FROM anon, authenticated;', t);
  END LOOP;
END $$;

-- Defense in depth: revoke schema-wide and future-table grants for the public
-- API roles so a newly-created table never silently reopens the hole.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- NOTE: service_role grants are intentionally untouched — the backend depends on
-- them. Do NOT add ENABLE ... FORCE (service_role has BYPASSRLS, so FORCE is a
-- no-op for it but would surprise any owner-context tooling).
```

- [ ] **Step 2: Lint the SQL visually**

Run: `cat backend/migrations/024_enable_rls.sql`
Expected: the file matches the block above; the `DO $$ … $$` block is balanced and the trailing `ALTER DEFAULT PRIVILEGES` statements are present. (No automated apply — this is run by hand per the runbook.)

- [ ] **Step 3: Commit**

```bash
cd /Users/santiagotorres/Developer/exjet-dashboard
git add backend/migrations/024_enable_rls.sql
git commit -m "$(printf 'fix(security/C3): add 024_enable_rls.sql (manual-apply)\n\nEnable RLS + revoke anon/authenticated grants on every public table.\nBackend uses the service-role key (BYPASSRLS) so app behavior is\nunchanged; this closes the anon-key PostgREST bypass.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 6: H3 + I5 + rollout — remediation runbook

**Files:**
- Create: `docs/superpowers/specs/2026-06-29-security-remediation-runbook.md`

- [ ] **Step 1: Write the runbook**

Create `docs/superpowers/specs/2026-06-29-security-remediation-runbook.md`:

```markdown
# Security Remediation Runbook (2026-06-29)

Operational steps that accompany the `fix/security-crit-high` code changes.
These touch Supabase / Railway / git history and must be run by a human with
the right credentials. **Do them in this order.**

## 0. Pre-req
- The `fix/security-crit-high` branch is merged-ready but **NOT yet deployed**.
- You have Supabase project admin, Railway project access, and push rights.

## 1. Rotate the leaked Supabase keys (H3)
The service-role key was committed in git history (`backend/.env`, commit
`db03a3d`, reachable from `origin/main`). Treat it as compromised.
1. Supabase Dashboard → Project Settings → API → roll the **service_role** key
   and the **anon** key.
2. Update **Railway** backend env: `SUPABASE_SERVICE_KEY` (= new service key),
   `SUPABASE_ANON_KEY` (= new anon key).
3. Update **Vercel** frontend env: `VITE_SUPABASE_ANON_KEY` (= new anon key).
4. Redeploy backend (Railway) and frontend (Vercel). Verify login still works.

## 2. Purge the secret from git history (H3)
Rotation makes the old key useless, but purge anyway (avoids leaking structure
and any other historical values).
1. `git clone --mirror git@github.com:Exjetaviation/exjet-dashboard.git` (fresh).
2. `git filter-repo --path backend/.env --invert-paths` (or BFG:
   `bfg --delete-files .env`).
3. Force-push: `git push --force`.
4. Tell every collaborator to re-clone (old clones still contain the secret).

## 3. Migrate roles to app_metadata — BEFORE deploying the H2 code change
The backend now reads the role from `app_metadata.app_role`. Existing grants
live in `user_metadata`. Run this ONCE in the Supabase SQL editor *before* the
`fix/security-crit-high` backend deploy, or every editor drops to `crew`:

    update auth.users
    set raw_app_meta_data =
      coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('app_role', raw_user_meta_data->>'app_role')
    where raw_user_meta_data ? 'app_role';

Going forward, grant roles via the Admin API / dashboard **app_metadata**
(`supabase.auth.admin.updateUserById(id, { app_metadata: { app_role: '…' } })`),
never user_metadata. Spot-check one admin: confirm `app_metadata.app_role` is
set, then log in and confirm editor actions still work.

## 4. Apply the RLS migration (C3)
1. Paste `backend/migrations/024_enable_rls.sql` into the Supabase SQL editor and
   run it.
2. Dashboard → Advisors / Database Linter: confirm the "RLS disabled in public"
   warnings clear for every table.
3. Smoke-test the app (it uses the service-role key → unaffected).

## 5. Pin NODE_ENV (I5)
Railway backend env: set `NODE_ENV=production`. Redeploy. (Suppresses Express
default error-handler stack traces.)

## 6. Verify the fixes (post-deploy)
Expect HTTP 401 (no body leak) on each:

    curl -i https://<prod>/api/finances/callback/summary
    curl -i https://<prod>/api/finances/debug/financials
    curl -i https://<prod>/api/quotes/auth-callback/list
    curl -i -X DELETE https://<prod>/api/quotes/auth-callback/anything

Confirm OAuth still works: re-run the QuickBooks and Gmail connect flows from the
admin UI (redirect URIs `/api/finances/callback` and `/api/quotes/auth-callback`
are unchanged). Confirm an authenticated editor can still book/price a trip, and
that a `crew` user cannot self-promote (set `user_metadata.app_role='admin'` in
the browser console → still 403 on a mutation).

## 7. Confirm env hygiene
- `git ls-files | grep -E '(^|/)\.env$'` → empty (no tracked .env).
- Verify `QB_REDIRECT_URI` ends with `/api/finances/callback` and
  `GMAIL_REDIRECT_URI` ends with `/api/quotes/auth-callback` (so the single
  public routes match what the providers call).
```

- [ ] **Step 2: Commit**

```bash
cd /Users/santiagotorres/Developer/exjet-dashboard
git add docs/superpowers/specs/2026-06-29-security-remediation-runbook.md
git commit -m "$(printf 'docs(security): remediation runbook (H3 key rotation, C3/H2 rollout, I5)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Task 7: Keep CLAUDE.md current + full verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update §3 (migrations)**

In `CLAUDE.md` §3 "Migrations — applied MANUALLY", change the range `**`001` … `023`**, latest `023_divert.sql`` to `**`001` … `024`**, latest `024_enable_rls.sql``, and append to the gating sentence: `; `024` enables RLS + revokes anon/authenticated grants on all public tables (audit C3).`

- [ ] **Step 2: Update §16 (auth & security model)**

- In the **Backend** bullet, change `(`role = user_metadata.app_role || 'crew'`)` to `(`role = app_metadata.app_role || 'crew'` — app_metadata is service-role-only, NOT user-writable user_metadata)`.
- In the **Mounting** bullet, change `public (pre-guard) = `/health`, `/api/finances/callback`, `/api/quotes/auth-callback`, **`/quote`**, **`/itinerary`**. Everything else under `/api/*` requires auth, **except `/api/finances/debug/*`** (temporary exemption).` to `public (pre-guard) = `/health`, the two exact OAuth-redirect routes `/api/finances/callback` and `/api/quotes/auth-callback` (single `app.get` handlers, NOT whole-router mounts — audit C1/C2), **`/quote`**, **`/itinerary`**. Everything else under `/api/*` requires auth (no exemptions; the `/finances/debug/*` bypass was removed — audit H1).`

- [ ] **Step 3: Update §12 (finances)**

In `CLAUDE.md` §12, change the clause `and temporary **`/debug/*`** endpoints that are **exempted from auth** in `index.js` (TODO: remove with the debug routes).` to `(the former temporary `/debug/*` endpoints and their auth exemption were removed — audit H1).` Leave the `**`GET /callback` is PUBLIC**` note (still true — it is the single public OAuth route).

- [ ] **Step 4: Update §18 + §19**

- §18 header: change `Migrations `001`–`023`` to `Migrations `001`–`024``.
- §19: change `**Auth-guarded `/api/*`** (exempt: `/api/finances/debug/*`):` to `**Auth-guarded `/api/*`** (no exemptions):` and in the `finances.js` row change `exempt `/debug/*`.` to `(debug routes removed).`

- [ ] **Step 5: Run the full backend + frontend test suites**

Run: `cd /Users/santiagotorres/Developer/exjet-dashboard && node --test backend/src/scheduling/*.test.js backend/src/services/*.test.js backend/src/services/fuel/*.test.js backend/src/slack/*.test.js backend/src/agent/*.test.js backend/src/agent/tools/*.test.js backend/src/middleware/*.test.js`
Expected: all pass (the only new test is `role.test.js`; nothing else changed behavior).
Run: `cd /Users/santiagotorres/Developer/exjet-dashboard && node --test frontend/src/lib/*.test.js`
Expected: all pass.
Run: `cd /Users/santiagotorres/Developer/exjet-dashboard/frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
cd /Users/santiagotorres/Developer/exjet-dashboard
git add CLAUDE.md
git commit -m "$(printf 'docs(security): update CLAUDE.md for crit/high remediation\n\nRole source (app_metadata), public OAuth mounts (C1/C2), removed debug\nexemption (H1), migration 024 (C3).\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Final state

After Task 7, `fix/security-crit-high` contains 7 commits closing C1/C2/H1/H2 in code and delivering the C3 migration + the H3/I5/rollout runbook. **Do not push** — present the combined diff + a one-line diagnosis and wait for an explicit "push". The operational steps (runbook) are executed by a human; the code is verified by the unit test (`role.test.js`), the full suite, the frontend build, and the post-deploy curl probes in runbook §6.

## Self-review

- **Spec coverage:** C1 → Tasks 2+4; C2 → Tasks 3+4; H1 → Tasks 2+4; H2 → Task 1; C3 → Task 5; H3/I5/rollout → Task 6; CLAUDE.md (standing instruction) → Task 7. All in-scope spec items have a task.
- **Placeholder scan:** none — every edit shows exact old→new code, every command shows expected output.
- **Type/name consistency:** `roleFromUser` (Task 1) matches its use in `requireAuth.js`; `financeOauthCallback` (Task 2) and `gmailOauthCallback` (Task 3) match the named imports in `index.js` (Task 4).
