import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { SERVICE_ACCOUNT_PERMISSIONS } from "@/lib/service-account-permissions";

const API_ROUTE_DIRS = ["src/app/api/v1", "src/app/api/metrics"];
const CATALOG_CONSUMERS = [
  "src/server/routers/service-account.ts",
  "src/server/middleware/api-auth.ts",
  "src/app/(dashboard)/settings/service-accounts/_client.tsx",
];

function routeFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(fullPath);
    return entry.isFile() && entry.name === "route.ts" ? [fullPath] : [];
  });
}

function apiRoutePermissions(): string[] {
  const permissions = new Set<string>();
  const permissionPattern =
    /\bapiRoute\(\s*["']([^"']+)["']|\bhasPermission\([^,]+,\s*["']([^"']+)["']/g;

  for (const file of API_ROUTE_DIRS.flatMap(routeFiles)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(permissionPattern)) {
      permissions.add(match[1] ?? match[2]);
    }
  }

  return [...permissions].sort();
}

describe("service account permission catalog", () => {
  it("is imported by service-account creation and API auth surfaces", () => {
    for (const file of CATALOG_CONSUMERS) {
      expect(fs.readFileSync(file, "utf8")).toContain(
        "@/lib/service-account-permissions",
      );
    }
  });

  it("matches every permission referenced by API routes", () => {
    expect([...SERVICE_ACCOUNT_PERMISSIONS].sort()).toEqual(apiRoutePermissions());
  });
});
