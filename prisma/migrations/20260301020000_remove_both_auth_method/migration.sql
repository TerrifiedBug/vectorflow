-- Convert any existing BOTH users to OIDC (SSO takeover removes local login)
UPDATE "User" SET "authMethod" = 'OIDC', "passwordHash" = NULL WHERE "authMethod" = 'BOTH';

-- Recreate enum without BOTH value
ALTER TYPE "AuthMethod" RENAME TO "AuthMethod_old";
CREATE TYPE "AuthMethod" AS ENUM ('LOCAL', 'OIDC');
ALTER TABLE "User" ALTER COLUMN "authMethod" TYPE "AuthMethod" USING "authMethod"::text::"AuthMethod";
DROP TYPE "AuthMethod_old";
