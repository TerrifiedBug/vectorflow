-- NF-1: curated template packs (bundles of system templates).
--
-- New tenant table `TemplatePack` with strict RLS (org isolation by
-- organizationId, matching every other tenant table). Two additive,
-- backwards-compatible columns on the existing `Template` table link a
-- template to a pack (`packId`, SET NULL on pack delete) and flag curated
-- templates (`featured`). System packs are seeded with organizationId =
-- 'default' by seedCuratedPacks() on boot.

-- CreateTable
CREATE TABLE "TemplatePack" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT 'default',
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "icon" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplatePack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Composite leading-organizationId index (satisfies verify-indexes.sh and
-- serves pack.list's `WHERE organizationId IN (...) ORDER BY featured`).
CREATE INDEX "TemplatePack_organizationId_featured_idx" ON "TemplatePack"("organizationId", "featured");

-- AlterTable: link templates to packs (nullable) + curated flag (defaulted).
-- Both are additive on an existing table; no backfill required.
ALTER TABLE "Template" ADD COLUMN "packId" TEXT;
ALTER TABLE "Template" ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_packId_fkey" FOREIGN KEY ("packId") REFERENCES "TemplatePack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-level security: tenant isolation by organizationId (matches the GUC set
-- by withOrgTx; the OSS table-owner role is BYPASSRLS so this is install-only
-- there, and enforced for the NOBYPASSRLS vectorflow_app role in multi-tenant).
DO $$
DECLARE
    tbl text;
    tenant_tables text[] := ARRAY['TemplatePack'];
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
    RAISE NOTICE 'template-pack: RLS installed on TemplatePack';
END $$;
