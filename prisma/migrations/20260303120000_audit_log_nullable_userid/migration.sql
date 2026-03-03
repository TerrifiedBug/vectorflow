-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "userId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");
