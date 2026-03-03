-- AlterTable: add isSystem column
ALTER TABLE "Environment" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: make teamId nullable (system environment has no team)
ALTER TABLE "Environment" ALTER COLUMN "teamId" DROP NOT NULL;
