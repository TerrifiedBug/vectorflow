-- AlterTable: Add AI configuration fields to Team
ALTER TABLE "Team" ADD COLUMN "aiProvider" TEXT;
ALTER TABLE "Team" ADD COLUMN "aiBaseUrl" TEXT;
ALTER TABLE "Team" ADD COLUMN "aiApiKey" TEXT;
ALTER TABLE "Team" ADD COLUMN "aiModel" TEXT;
ALTER TABLE "Team" ADD COLUMN "aiEnabled" BOOLEAN NOT NULL DEFAULT false;
