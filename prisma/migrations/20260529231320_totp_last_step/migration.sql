-- AlterTable: track the highest consumed TOTP time-step per user so live TOTP
-- codes become single-use within their validation window (replay prevention).
ALTER TABLE "User" ADD COLUMN "lastTotpStep" INTEGER;
