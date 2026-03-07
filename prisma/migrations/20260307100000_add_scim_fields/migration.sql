-- AlterTable
ALTER TABLE "User" ADD COLUMN "scimExternalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_scimExternalId_key" ON "User"("scimExternalId");

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN "scimEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSettings" ADD COLUMN "scimBearerToken" TEXT;
