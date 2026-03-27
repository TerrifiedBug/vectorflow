import { describe, it, expect } from "vitest";
import { generateOpenAPISpec } from "./openapi-spec";

describe("generateOpenAPISpec", () => {
  it("returns an object with openapi === '3.1.0'", () => {
    const spec = generateOpenAPISpec();
    expect(spec.openapi).toBe("3.1.0");
  });

  it("has correct info.title and info.version", () => {
    const spec = generateOpenAPISpec();
    expect(spec.info.title).toBe("VectorFlow REST API");
    expect(spec.info.version).toBe("1.0.0");
  });

  it("spec.paths contains all 16 operations", () => {
    const spec = generateOpenAPISpec();
    const paths = spec.paths as Record<string, Record<string, unknown>>;

    // Pipeline operations
    expect(paths["/api/v1/pipelines"]?.get).toBeDefined();
    expect(paths["/api/v1/pipelines/{id}"]?.get).toBeDefined();
    expect(paths["/api/v1/pipelines/{id}/deploy"]?.post).toBeDefined();
    expect(paths["/api/v1/pipelines/{id}/rollback"]?.post).toBeDefined();
    expect(paths["/api/v1/pipelines/{id}/undeploy"]?.post).toBeDefined();
    expect(paths["/api/v1/pipelines/{id}/versions"]?.get).toBeDefined();

    // Node operations
    expect(paths["/api/v1/nodes"]?.get).toBeDefined();
    expect(paths["/api/v1/nodes/{id}"]?.get).toBeDefined();
    expect(paths["/api/v1/nodes/{id}/maintenance"]?.post).toBeDefined();

    // Secret operations
    expect(paths["/api/v1/secrets"]?.get).toBeDefined();
    expect(paths["/api/v1/secrets"]?.post).toBeDefined();
    expect(paths["/api/v1/secrets"]?.put).toBeDefined();
    expect(paths["/api/v1/secrets"]?.delete).toBeDefined();

    // Alert operations
    expect(paths["/api/v1/alerts/rules"]?.get).toBeDefined();
    expect(paths["/api/v1/alerts/rules"]?.post).toBeDefined();

    // Audit operations
    expect(paths["/api/v1/audit"]?.get).toBeDefined();
  });

  it("every operation has a security requirement referencing BearerAuth", () => {
    const spec = generateOpenAPISpec();
    const paths = spec.paths as Record<string, Record<string, unknown>>;

    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        const op = operation as { security?: Array<Record<string, unknown[]>> };
        expect(op.security, `${method.toUpperCase()} ${path} should have security`).toBeDefined();
        expect(op.security!.length, `${method.toUpperCase()} ${path} security should not be empty`).toBeGreaterThan(0);
        const secKeys = Object.keys(op.security![0]);
        expect(secKeys, `${method.toUpperCase()} ${path} should use BearerAuth`).toContain("BearerAuth");
      }
    }
  });

  it("every operation has at least one response with a content schema", () => {
    const spec = generateOpenAPISpec();
    const paths = spec.paths as Record<string, Record<string, unknown>>;

    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        const op = operation as { responses?: Record<string, { content?: Record<string, unknown>; description?: string }> };
        expect(op.responses, `${method.toUpperCase()} ${path} should have responses`).toBeDefined();
        const hasContentSchema = Object.values(op.responses!).some(
          (r) => r.content && Object.keys(r.content).length > 0
        );
        expect(hasContentSchema, `${method.toUpperCase()} ${path} should have at least one response with a content schema`).toBe(true);
      }
    }
  });

  it("POST /api/v1/pipelines/{id}/deploy has requestBody with changelog field", () => {
    const spec = generateOpenAPISpec();
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    const deployOp = paths["/api/v1/pipelines/{id}/deploy"]?.post as {
      requestBody?: {
        content: {
          "application/json": {
            schema: {
              properties?: Record<string, unknown>;
            };
          };
        };
      };
    };

    expect(deployOp?.requestBody).toBeDefined();
    const schema = deployOp?.requestBody?.content?.["application/json"]?.schema;
    expect(schema?.properties?.changelog).toBeDefined();
  });

  it("GET /api/v1/audit has query parameters: after, limit, action", () => {
    const spec = generateOpenAPISpec();
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    const auditOp = paths["/api/v1/audit"]?.get as {
      parameters?: Array<{ name: string; in: string }>;
    };

    expect(auditOp?.parameters).toBeDefined();
    const paramNames = auditOp?.parameters?.map((p) => p.name) ?? [];
    expect(paramNames).toContain("after");
    expect(paramNames).toContain("limit");
    expect(paramNames).toContain("action");
  });
});
