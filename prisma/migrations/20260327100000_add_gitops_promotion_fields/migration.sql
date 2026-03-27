-- AlterTable: Add GitOps promotion tracking fields to PromotionRequest
ALTER TABLE "PromotionRequest" ADD COLUMN "prUrl" TEXT;
ALTER TABLE "PromotionRequest" ADD COLUMN "prNumber" INTEGER;
