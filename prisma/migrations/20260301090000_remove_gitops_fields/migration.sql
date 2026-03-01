-- AlterTable: Remove GitOps fields from Environment
ALTER TABLE "Environment" DROP COLUMN IF EXISTS "gitRepo";
ALTER TABLE "Environment" DROP COLUMN IF EXISTS "gitBranch";
ALTER TABLE "Environment" DROP COLUMN IF EXISTS "gitSshKey";
ALTER TABLE "Environment" DROP COLUMN IF EXISTS "gitHttpsToken";
ALTER TABLE "Environment" DROP COLUMN IF EXISTS "gitCommitAuthor";
ALTER TABLE "Environment" DROP COLUMN IF EXISTS "deployMode";

-- DropEnum
DROP TYPE IF EXISTS "DeployMode";
