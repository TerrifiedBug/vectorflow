-- AlterTable
ALTER TABLE "User" ADD COLUMN "totpSecret" TEXT,
ADD COLUMN "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "totpBackupCodes" TEXT;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN "requireTwoFactor" BOOLEAN NOT NULL DEFAULT false;
