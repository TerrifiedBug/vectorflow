-- AlterTable: SystemSettings -- add S3 remote storage configuration fields
ALTER TABLE "SystemSettings" ADD COLUMN "backupStorageBackend" TEXT NOT NULL DEFAULT 'local';
ALTER TABLE "SystemSettings" ADD COLUMN "s3Bucket" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "s3Region" TEXT DEFAULT 'us-east-1';
ALTER TABLE "SystemSettings" ADD COLUMN "s3Prefix" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "s3AccessKeyId" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "s3SecretAccessKey" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "s3Endpoint" TEXT;
