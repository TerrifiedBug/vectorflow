-- AlterTable: add enrollmentTokenId to Environment for O(1) enrollment-token lookup (VF-36).
-- Existing (legacy) tokens have no embedded identifier and keep enrollmentTokenId NULL;
-- the enroll route falls back to the per-environment scan for those until they are regenerated.
ALTER TABLE "Environment" ADD COLUMN "enrollmentTokenId" TEXT;

-- CreateIndex
CREATE INDEX "Environment_enrollmentTokenId_idx" ON "Environment"("enrollmentTokenId");
