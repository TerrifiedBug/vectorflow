-- Audit P2-10 + P2-11 defense-in-depth migrations bundled into one
-- file because they're all small one-shot ALTERs / index creations and
-- splitting would dilute the diff.

-- ── P2-10: organizationId on WebAuthnChallenge + ActiveTap ──────────────────
--
-- Both tables had no tenant column. WebAuthnChallenge is protected
-- against enumeration by the 256-bit random challenge value, and
-- ActiveTap is protected by the inline auth in `pipeline.stopTap`, but
-- adding the column unblocks RLS coverage for any future query that
-- bypasses those code paths.

ALTER TABLE "WebAuthnChallenge"
    ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "WebAuthnChallenge_organizationId_expiresAt_idx"
    ON "WebAuthnChallenge"("organizationId", "expiresAt");

ALTER TABLE "ActiveTap"
    ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS "ActiveTap_organizationId_expiresAt_idx"
    ON "ActiveTap"("organizationId", "expiresAt");

DO $$
DECLARE
    tbl text;
    tenant_tables text[] := ARRAY['WebAuthnChallenge', 'ActiveTap'];
BEGIN
    FOREACH tbl IN ARRAY tenant_tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
        EXECUTE format(
            'DROP POLICY IF EXISTS %I ON %I;',
            tbl || '_org_isolation', tbl);
        EXECUTE format($p$
            CREATE POLICY %I ON %I
            USING (
                "organizationId" = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'app_org_id_unset_sentinel')
                OR COALESCE(NULLIF(current_setting('app.org_id', true), ''), '') = ''
            )
            WITH CHECK (
                "organizationId" = COALESCE(NULLIF(current_setting('app.org_id', true), ''), 'app_org_id_unset_sentinel')
                OR COALESCE(NULLIF(current_setting('app.org_id', true), ''), '') = ''
            );
        $p$, tbl || '_org_isolation', tbl);
    END LOOP;
END $$;

-- ── P2-11: global uniqueness on verified OrganizationDomainClaim ───────────
--
-- The Prisma schema enforces (organizationId, domain) uniqueness, but
-- two different orgs could in principle race to verifiedAt at the same
-- time on the same domain — the application-layer guard inside
-- org.verifyDomain checks but is not atomic against concurrent writers.
-- A partial unique index on `domain WHERE verifiedAt IS NOT NULL`
-- collapses the race to a single winner; the loser's INSERT fails at
-- Postgres-level uniqueness violation.

CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationDomainClaim_domain_verified_unique"
    ON "OrganizationDomainClaim"("domain")
    WHERE "verifiedAt" IS NOT NULL;
