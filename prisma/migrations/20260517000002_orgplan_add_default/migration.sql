-- §15a R3 remediation — generalise plan quotas so the AGPL OSS repo
-- does not ship a FREE/PRO/ENTERPRISE commercial pricing schedule.
--
-- Step 1: add a non-commercial `DEFAULT` value to the OrgPlan enum.
--   FREE/PRO/ENTERPRISE remain on the enum for Cloud preview rows;
--   the Cloud build's `QuotaPolicyProvider` (in cloud/) is responsible
--   for the commercial schedule and the names live there.
--
-- Step 2: change the `Organization.plan` column default from FREE → DEFAULT
--   so new orgs created on a default OSS deployment are not labelled with
--   a Cloud commercial tier. Existing rows keep whatever plan they had
--   (no backfill — OSS deployments only ever had `plan = 'FREE'` from
--   Phase 1 migration, but the value is still legal on the enum and the
--   OSS quota provider treats every plan as DEFAULT-equivalent until
--   Cloud overrides).
--
-- Postgres requires `ALTER TYPE … ADD VALUE` to run outside a
-- transaction; Prisma migrations run each statement in its own
-- implicit tx, so we use IF NOT EXISTS for idempotency.
--
-- Rollback (manual; non-trivial because Postgres doesn't support
-- ALTER TYPE … REMOVE VALUE):
--   1. UPDATE "Organization" SET "plan" = 'FREE' WHERE "plan" = 'DEFAULT';
--   2. CREATE TYPE "OrgPlan_new" AS ENUM ('FREE','PRO','ENTERPRISE');
--   3. ALTER TABLE "Organization" ALTER COLUMN "plan" TYPE "OrgPlan_new" USING "plan"::text::"OrgPlan_new";
--   4. DROP TYPE "OrgPlan"; ALTER TYPE "OrgPlan_new" RENAME TO "OrgPlan";
--   5. ALTER TABLE "Organization" ALTER COLUMN "plan" SET DEFAULT 'FREE';

ALTER TYPE "OrgPlan" ADD VALUE IF NOT EXISTS 'DEFAULT';

ALTER TABLE "Organization" ALTER COLUMN "plan" SET DEFAULT 'DEFAULT';
