--
-- Add `organizationId` to Secret / Certificate / CertificateBundle so
-- RLS can fence direct queries that bypass the environment → team →
-- org join. Backfill from the parent Environment row; install RLS
-- policies that match the rest of the strict RLS policies (organizationId GUC
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

-- ─── 4. RLS — match the the strict RLS policies STRICT policy ─────────────────────────────
--
-- Three tenant tables, three identical policies. Same shape as
-- 20260516000003: when `app.org_id` is unset
-- `current_setting('app.org_id', true)` returns NULL → equality is
-- NULL → policy denies. OSS bypasses via the table-owner role's
-- BYPASSRLS default; Cloud's non-owner role is fenced.

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
            USING ("organizationId" = current_setting('app.org_id', true))
            WITH CHECK ("organizationId" = current_setting('app.org_id', true));
        $p$, tbl || '_org_isolation', tbl);
    END LOOP;
END $$;
