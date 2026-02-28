-- AlterTable: Remove deployMode from Environment
ALTER TABLE "Environment" DROP COLUMN "deployMode";

-- AlterTable: Remove defaultDeployMode from SystemSettings
ALTER TABLE "SystemSettings" DROP COLUMN "defaultDeployMode";

-- DropEnum
DROP TYPE "DeployMode";
