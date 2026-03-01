-- AlterTable
ALTER TABLE "User" ADD COLUMN "lockedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "lockedBy" TEXT;
