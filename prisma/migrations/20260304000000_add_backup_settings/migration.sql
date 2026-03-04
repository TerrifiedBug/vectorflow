-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN "backupEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN "backupCron" TEXT NOT NULL DEFAULT '0 2 * * *';
ALTER TABLE "SystemSettings" ADD COLUMN "backupRetentionCount" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "SystemSettings" ADD COLUMN "lastBackupAt" TIMESTAMP(3);
ALTER TABLE "SystemSettings" ADD COLUMN "lastBackupStatus" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "lastBackupError" TEXT;
