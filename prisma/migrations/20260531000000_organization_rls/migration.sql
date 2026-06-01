-- Fence the Organization table itself.
--
-- Organization has no `organizationId` column — its primary key `id` IS the
-- tenant identifier. So unlike every other tenant table, its RLS policy
-- compares the row's `id` (not `organizationId`) against
-- `current_setting('app.org_id', true)`. With a scope set, a tenant sees only
-- its OWN org row; with no scope set the fenced role sees none. This closes the
-- gap where the fenced `vectorflow_app` role could enumerate every org's
-- id / slug / name / plan (and the wrapped DEK ciphertext).
--
-- Cross-org and pre-context readers go through the admin (owner) connection,
-- which bypasses RLS at the role level rather than via any session GUC:
--   - subdomain → org resolution (src/lib/host-to-org.ts, agent-org-binding.ts)
--   - credential → org auth (createContext, api-auth, agent-auth, SCIM auth)
--   - per-org maintenance loops' org enumeration (schedulers)
--   - the DEK ciphertext loader (crypto-v3-callsite.ts) and per-org JWT key
--   - operator / platform reads
-- In-context readers (an org reading its OWN row by id while scoped to that
-- org) keep using the fenced app client — the policy admits the matching row.
--
-- ENABLE (not FORCE): the table-owner role must keep bypassing so OSS single-
-- tenant is unaffected and the admin connection can read across orgs. The
-- isolation comes from the runtime app role being NOBYPASSRLS, exactly as for
-- the other tenant tables (see 20260516000003).

DO $$
BEGIN
    EXECUTE 'ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Organization_org_isolation" ON "Organization"';
    EXECUTE $p$
        CREATE POLICY "Organization_org_isolation" ON "Organization"
        USING ("id" = current_setting('app.org_id', true))
        WITH CHECK ("id" = current_setting('app.org_id', true));
    $p$;
    RAISE NOTICE 'organization-rls: strict policy installed on Organization (id = app.org_id)';
END $$;
