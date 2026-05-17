-- BillingProviderRef RLS hardening: drop the `app.bypass_rls`
-- session-GUC bypass clause from the isolation policy.
--
-- Rationale: the original policy permitted bypass when
-- `current_setting('app.bypass_rls', true) = 'on'`. Any session with
-- DML grants on this table could call `SET LOCAL app.bypass_rls='on'`
-- to cross-read tenants — RLS effectively opt-in. Codex P1 finding
-- against PR #364.
--
-- Correct boundary: admin reads happen at the role level. The
-- `vectorflow_app` runtime role is explicitly NOBYPASSRLS (Phase 4c
-- migration). The Cloud-side admin connection (DATABASE_ADMIN_URL)
-- uses the owner role with BYPASSRLS, so Postgres skips RLS at the
-- engine level for that connection without needing a GUC.
--
-- This migration is idempotent. It replaces the original policy with
-- the strict shape from `20260516000003_phase5a_rls_strict_policies`.
-- If the original migration was never applied, this migration also
-- creates the policy correctly so the end state is identical.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'BillingProviderRef'
       AND policyname = 'BillingProviderRef_isolation'
  ) THEN
    DROP POLICY "BillingProviderRef_isolation" ON "BillingProviderRef";
  END IF;

  -- Re-create with the strict shape — no session-GUC bypass.
  CREATE POLICY "BillingProviderRef_isolation" ON "BillingProviderRef"
    AS PERMISSIVE
    FOR ALL
    TO PUBLIC
    USING (
      "organizationId" = current_setting('app.org_id', true)
    )
    WITH CHECK (
      "organizationId" = current_setting('app.org_id', true)
    );

  RAISE NOTICE 'billing-provider-ref-rls-hardening: bypass GUC removed';
END
$$;
