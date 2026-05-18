-- Generalise plan quotas: introduce a non-commercial `DEFAULT` plan value
-- so the upstream repo does not ship a hardcoded commercial pricing tier
-- schedule. The FREE/PRO/ENTERPRISE values remain on the enum so callers
-- that need them can still use them, but the default plan for newly
-- created orgs becomes `DEFAULT`.
--
-- Step 1: add a non-commercial `DEFAULT` value to the OrgPlan enum.
--   The actual quota schedule per plan is a runtime-injected
--   `QuotaPolicyProvider`; this migration only widens the enum.
--
-- Step 2: change the `Organization.plan` column default from FREE → DEFAULT
--   so newly created orgs on a default deployment are not labelled with
--   a commercial tier. Existing rows keep whatever plan they had
--   (no backfill — the value is still legal on the enum and the default
--   quota provider treats every plan as DEFAULT-equivalent until an
--   overriding provider is registered).
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
