-- AlterTable
ALTER TABLE "Environment" ADD COLUMN "gitRepoUrl" TEXT,
ADD COLUMN "gitBranch" TEXT DEFAULT 'main',
ADD COLUMN "gitToken" TEXT;
