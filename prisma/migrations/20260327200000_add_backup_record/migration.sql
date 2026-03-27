-- CreateTable: BackupRecord -- stores per-backup metadata, status, and checksums
CREATE TABLE "BackupRecord" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sizeBytes" BIGINT,
    "durationMs" INTEGER,
    "storageLocation" TEXT NOT NULL,
    "checksum" TEXT,
    "vfVersion" TEXT,
    "migrationCount" INTEGER,
    "lastMigration" TEXT,
    "pgVersion" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BackupRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackupRecord_startedAt_idx" ON "BackupRecord"("startedAt");

-- CreateIndex
CREATE INDEX "BackupRecord_status_idx" ON "BackupRecord"("status");
