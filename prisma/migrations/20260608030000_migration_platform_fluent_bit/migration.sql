-- Add FLUENT_BIT to the MigrationPlatform enum so Fluent Bit configs can be imported.
--
-- ALTER TYPE ... ADD VALUE runs fine inside Prisma's migration transaction on
-- PG16 because the new value is only added here, not USED within this migration.
-- IF NOT EXISTS keeps the statement idempotent across re-applies.
ALTER TYPE "MigrationPlatform" ADD VALUE IF NOT EXISTS 'FLUENT_BIT';
