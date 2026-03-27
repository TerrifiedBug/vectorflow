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

  // Count paths and operations for confirmation log
  const paths = spec.paths as Record<string, Record<string, unknown>>;
  const pathCount = Object.keys(paths).length;
  const operationCount = Object.values(paths).reduce((acc, methods) => {
    const httpMethods = ["get", "post", "put", "delete", "patch", "head", "options"];
    return acc + Object.keys(methods).filter((m) => httpMethods.includes(m)).length;
  }, 0);

  console.log(`OpenAPI spec written to public/openapi.json`);
  console.log(`  Paths: ${pathCount}`);
  console.log(`  Operations: ${operationCount}`);

  process.exit(0);
} catch (err) {
  console.error("Failed to generate OpenAPI spec:", err);
  process.exit(1);
}
