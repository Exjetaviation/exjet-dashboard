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
