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
