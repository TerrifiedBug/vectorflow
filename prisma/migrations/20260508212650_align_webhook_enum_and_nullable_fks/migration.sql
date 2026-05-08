-- Align enum-backed webhook columns and nullable foreign keys with the Prisma schema.

-- Update FK semantics for nullable relations.
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_userId_fkey";
ALTER TABLE "Environment" DROP CONSTRAINT "Environment_teamId_fkey";

ALTER TABLE "WebhookDelivery"
ALTER COLUMN "eventType" TYPE "AlertMetric"
USING ("eventType"::"AlertMetric");

ALTER TABLE "WebhookEndpoint"
ALTER COLUMN "eventTypes" TYPE "AlertMetric"[]
USING ("eventTypes"::text[]::"AlertMetric"[]);

ALTER TABLE "Environment"
ADD CONSTRAINT "Environment_teamId_fkey"
FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditLog"
ADD CONSTRAINT "AuditLog_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
