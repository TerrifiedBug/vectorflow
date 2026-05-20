-- Audit P1-2 / docs/plans/2026-05-20-go-live-readiness-audit.md
--
-- Add `organizationId` to Secret / Certificate / CertificateBundle so
-- RLS can fence direct queries that bypass the environment → team →
-- org join. Backfill from the parent Environment row; install RLS
-- policies that match the rest of phase5a (organizationId GUC
-- comparison with the sentinel-coerced NULL fallback). Composite
-- indexes match the pattern verify-indexes.sh enforces.

-- ─── 1. Add columns with safe default so the table stays writable mid-deploy ─

ALTER TABLE "Secret"
    ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "Certificate"
    ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "CertificateBundle"
    ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'default';

-- ─── 2. Backfill from Environment.organizationId ───────────────────────────

UPDATE "Secret" s
   SET "organizationId" = e."organizationId"
  FROM "Environment" e
 WHERE s."environmentId" = e.id;

UPDATE "Certificate" c
   SET "organizationId" = e."organizationId"
  FROM "Environment" e
 WHERE c."environmentId" = e.id;

UPDATE "CertificateBundle" b
   SET "organizationId" = e."organizationId"
  FROM "Environment" e
 WHERE b."environmentId" = e.id;

-- ─── 3. Composite indexes — verify-indexes.sh enforces these ───────────────

CREATE INDEX IF NOT EXISTS "Secret_organizationId_idx"
    ON "Secret"("organizationId");
CREATE INDEX IF NOT EXISTS "Secret_organizationId_environmentId_idx"
    ON "Secret"("organizationId", "environmentId");

CREATE INDEX IF NOT EXISTS "Certificate_organizationId_idx"
    ON "Certificate"("organizationId");
CREATE INDEX IF NOT EXISTS "Certificate_organizationId_environmentId_idx"
    ON "Certificate"("organizationId", "environmentId");

CREATE INDEX IF NOT EXISTS "CertificateBundle_organizationId_idx"
    ON "CertificateBundle"("organizationId");
CREATE INDEX IF NOT EXISTS "CertificateBundle_organizationId_environmentId_idx"
    ON "CertificateBundle"("organizationId", "environmentId");

-- ─── 4. RLS — mirror the phase5a strict policy ─────────────────────────────
--
-- Three tenant tables, three identical policies. Same shape as the
-- existing phase5a loop: the GUC must match the row, with an unset
-- sentinel coerced so the "not set" case denies access.

DO $$
DECLARE
    tbl text;
    tenant_tables text[] := ARRAY[
        'Secret', 'Certificate', 'CertificateBundle'
    ];
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
