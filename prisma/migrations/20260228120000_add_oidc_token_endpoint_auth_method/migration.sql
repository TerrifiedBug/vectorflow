-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN "oidcTokenEndpointAuthMethod" TEXT DEFAULT 'client_secret_post';
