-- IF-6: saved VRL unit tests — named input→expected snippets pinned to a
-- pipeline transform component. New tenant table; org-scoped via RLS on
-- organizationId, mirroring TapCapture (the adjacent transform-eval table).

-- ─── 1. Table ────────────────────────────────────────────────────────────────
CREATE TABLE "VrlUnitTest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT 'default',
    "pipelineId" TEXT NOT NULL,
    "componentKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "expected" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VrlUnitTest_pkey" PRIMARY KEY ("id")
);

-- ─── 2. Indexes ──────────────────────────────────────────────────────────────
-- Composite leading on organizationId so the post-RLS hot path (tests listed
-- per org + pipeline) is an Index Scan; verify-indexes.sh requires the leading
-- organizationId composite. The pipelineId index backs the FK + pipeline scans.
CREATE INDEX "VrlUnitTest_organizationId_pipelineId_idx" ON "VrlUnitTest"("organizationId", "pipelineId");
CREATE INDEX "VrlUnitTest_pipelineId_idx" ON "VrlUnitTest"("pipelineId");

-- ─── 3. Foreign keys ─────────────────────────────────────────────────────────
ALTER TABLE "VrlUnitTest" ADD CONSTRAINT "VrlUnitTest_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 4. Row-level security (strict per-table policy) ─────────────────────────
DO $$
DECLARE
    tbl text;
    tenant_tables text[] := ARRAY['VrlUnitTest'];
BEGIN
    FOREACH tbl IN ARRAY tenant_tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', tbl || '_org_isolation', tbl);
        EXECUTE format($p$
            CREATE POLICY %I ON %I
            USING ("organizationId" = current_setting('app.org_id', true))
            WITH CHECK ("organizationId" = current_setting('app.org_id', true));
        $p$, tbl || '_org_isolation', tbl);
    END LOOP;
    RAISE NOTICE 'IF-6: RLS installed on VrlUnitTest';
END $$;
