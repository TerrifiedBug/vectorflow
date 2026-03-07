-- AlterTable
ALTER TABLE "Environment" ADD COLUMN "gitOpsMode" TEXT NOT NULL DEFAULT 'off';
ALTER TABLE "Environment" ADD COLUMN "gitWebhookSecret" TEXT;
