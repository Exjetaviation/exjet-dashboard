# Security Remediation Runbook (2026-06-29)

Operational steps that accompany the `fix/security-crit-high` code changes.
These touch Supabase / Railway / git history and must be run by a human with
the right credentials. **Do them in this order.**

## 0. Pre-req
- The `fix/security-crit-high` branch is merged-ready but **NOT yet deployed**.
- You have Supabase project admin, Railway project access, and push rights.

## 1. Rotate the leaked Supabase keys (H3)
The **service key** (full-access DB credential) was committed in git history
(`backend/.env`, commit `db03a3d`). Treat it as compromised. Think of it as a
leaked master key: cut a new one, give it to the app, then make the old one stop
working.

> Rotating these API keys does NOT log users out — sessions use the JWT signing
> key, which we are not touching.

> **THE ONE RULE (this is what caused the outage the first time):** put the new
> key into Railway/Vercel and confirm the app works BEFORE disabling/deleting the
> old key. New key in → test → THEN disable old. If you disable the old key while
> the deployed app is still using it, the whole app goes down.

> **DO NOT touch "JWT secret" / "JWT signing keys" (a Rotate button under
> Settings → API).** Different switch — it WOULD log out every user. Not needed.

> **The backend uses TWO keys, not one:** `requireAuth.js` uses an **anon** key
> (to verify logins) and `services/supabase.js` uses the **service** key (for
> data). So Railway needs BOTH updated — missing the anon key breaks login.

### A. Replace the backend (service) key — urgent
1. supabase.com → project → **Settings → API Keys** → create a **new Secret key**
   (`sb_secret_…`). It bypasses RLS like the old service_role, so migration `024`
   still holds.
2. **Railway** → backend → **Variables** → set BOTH:
   - `SUPABASE_SERVICE_KEY` = new Secret key
   - `SUPABASE_ANON_KEY` = new Publishable key (from step B)
   Save → auto-redeploys.
3. Wait for redeploy, open the dashboard app, confirm data loads.
4. **Only then:** Supabase → disable/delete the old service_role / legacy keys.

### B. Replace the website (anon) key — defense in depth
1. Supabase → **API Keys** → create a **new Publishable key** (`sb_publishable_…`).
2. **Vercel** → project → **Settings → Environment Variables** →
   `VITE_SUPABASE_ANON_KEY` = new Publishable key → save → redeploy.
3. Confirm you can still log in.
4. Then disable the old anon key.

`SUPABASE_URL` / `VITE_SUPABASE_URL` do not change.

### Fallback — older "legacy keys only" dashboard
If **Settings → API Keys** offers no Secret/Publishable keys (only an older
anon/service_role screen with no individual revoke), the only way to kill the
legacy key is to **roll the JWT secret** (Settings → API → JWT Settings). ⚠️ That
regenerates both keys AND can log out all users. Prefer the new keys above.

## 2. Purge the secret from git history (H3) — DONE 2026-06-29
Rotation makes the old key useless, but we purged anyway. Steps used:
1. Fresh `git clone --mirror …`.
2. `git filter-repo --path backend/.env --invert-paths --force` (the single-file
   script from github.com/newren/git-filter-repo; no install needed).
3. Re-add origin (filter-repo drops it), then `git push --force --all` +
   `git push --force --tags`. Rewrote all 4 origin branches.
4. Resynced the local dev folder: reset `main` to the rewritten origin, deleted
   stale local/remote-tracking branches, `git remote prune origin`, reflog
   expire + `git gc --prune=now`. Verified `git log --all -- backend/.env` is
   empty on both origin and locally.

> ⚠️ **CAVEAT — GitHub PR refs.** A force-push does NOT remove commits referenced
> by pull requests: `refs/pull/1..10/head` still pin the old pre-rewrite commits,
> so the secret remains reachable via direct commit URLs / PR diffs (NOT via a
> normal `git clone`). You can't delete `refs/pull/*` yourself; only GitHub
> Support can GC them. **We accepted this residual exposure because the key is
> already rotated/dead** — the historical credential is useless. If you ever need
> it fully scrubbed, open a GitHub Support ticket: "remove cached views /
> unreachable commits after a history rewrite (sensitive data in refs/pull/*)."

> Anyone else with an old clone must re-clone — old clones still contain the
> secret and have incompatible history.

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
