/**
 * generate-openapi.ts
 *
 * Build-time script that generates the VectorFlow OpenAPI 3.1 specification
 * and writes it to public/openapi.json for static access.
 *
 * Usage:
 *   pnpm generate:openapi
 *
 * Output:
 *   public/openapi.json   — Machine-readable OpenAPI 3.1 specification
 */

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { generateOpenAPISpec } from "../src/app/api/v1/_lib/openapi-spec";

try {
  const spec = generateOpenAPISpec();

  const outDir = join(process.cwd(), "public");
  mkdirSync(outDir, { recursive: true });

  const jsonOutput = JSON.stringify(spec, null, 2);
  writeFileSync(join(outDir, "openapi.json"), jsonOutput, "utf8");

  // Count paths and operations, split by surface (REST v1 vs tRPC)
  const paths = spec.paths as Record<string, Record<string, { operationId?: string; tags?: string[] }>>;
  const httpMethods = ["get", "post", "put", "delete", "patch", "head", "options"];

  let restOps = 0;
  let trpcOps = 0;
  const duplicateOperationIds = new Set<string>();
  const seenOperationIds = new Set<string>();
  const pathsWithNoOps: string[] = [];

  for (const [path, methods] of Object.entries(paths)) {
    const ops = Object.entries(methods).filter(([m]) => httpMethods.includes(m));
    if (ops.length === 0) {
      pathsWithNoOps.push(path);
      continue;
    }

    for (const [, operation] of ops) {
      const isTrpc = operation.tags?.includes("tRPC") ?? path.startsWith("/api/trpc/");
      if (isTrpc) {
        trpcOps++;
      } else {
        restOps++;
      }

      // Check for duplicate operationIds
      if (operation.operationId) {
        if (seenOperationIds.has(operation.operationId)) {
          duplicateOperationIds.add(operation.operationId);
        }
        seenOperationIds.add(operation.operationId);
      }
    }
  }

  const totalOps = restOps + trpcOps;
  const pathCount = Object.keys(paths).length;

  console.log(`OpenAPI spec written to public/openapi.json`);
  console.log(`  Paths: ${pathCount}`);
  console.log(`  Operations: ${totalOps} (${restOps} REST v1, ${trpcOps} tRPC)`);

  // Validation warnings
  if (pathsWithNoOps.length > 0) {
    console.warn(`  WARNING: ${pathsWithNoOps.length} paths have no operations: ${pathsWithNoOps.join(", ")}`);
  }
  if (duplicateOperationIds.size > 0) {
    console.warn(`  WARNING: Duplicate operationIds found: ${[...duplicateOperationIds].join(", ")}`);
  }
  if (duplicateOperationIds.size === 0 && pathsWithNoOps.length === 0) {
    console.log(`  Validation: OK (no duplicate operationIds, all paths have operations)`);
  }

  process.exit(0);
} catch (err) {
  console.error("Failed to generate OpenAPI spec:", err);
  process.exit(1);
}
