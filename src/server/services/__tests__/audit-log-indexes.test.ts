import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationsDir = join(root, "prisma/migrations");

function allMigrationSql() {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(migrationsDir, entry.name, "migration.sql"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
}

describe("AuditLog query indexes", () => {
  it("keeps team and environment audit-list filters indexed in Prisma and SQL", () => {
    const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
    const migrationSql = allMigrationSql();

    expect(schema).toContain("@@index([teamId])");
    expect(schema).toContain("@@index([environmentId])");
    expect(migrationSql).toContain(
      'CREATE INDEX "AuditLog_teamId_idx" ON "AuditLog"("teamId");'
    );
    expect(migrationSql).toContain(
      'CREATE INDEX "AuditLog_environmentId_idx" ON "AuditLog"("environmentId");'
    );
  });
});
