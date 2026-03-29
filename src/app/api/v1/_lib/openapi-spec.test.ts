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
    expect(spec.info.version).toBe("2.0.0");
  });

  it("spec.paths contains all REST v1 operations (original 16 + new endpoints)", () => {
    const spec = generateOpenAPISpec();
    const paths = spec.paths as Record<string, Record<string, unknown>>;

    // Original 16
    expect(paths["/api/v1/pipelines"]?.get).toBeDefined();
    expect(paths["/api/v1/pipelines/{id}"]?.get).toBeDefined();
    expect(paths["/api/v1/pipelines/{id}/deploy"]?.post).toBeDefined();
    expect(paths["/api/v1/pipelines/{id}/rollback"]?.post).toBeDefined();
    expect(paths["/api/v1/pipelines/{id}/undeploy"]?.post).toBeDefined();
    expect(paths["/api/v1/pipelines/{id}/versions"]?.get).toBeDefined();
    expect(paths["/api/v1/nodes"]?.get).toBeDefined();
    expect(paths["/api/v1/nodes/{id}"]?.get).toBeDefined();
    expect(paths["/api/v1/nodes/{id}/maintenance"]?.post).toBeDefined();
    expect(paths["/api/v1/secrets"]?.get).toBeDefined();
    expect(paths["/api/v1/secrets"]?.post).toBeDefined();
    expect(paths["/api/v1/secrets"]?.put).toBeDefined();
    expect(paths["/api/v1/secrets"]?.delete).toBeDefined();
    expect(paths["/api/v1/alerts/rules"]?.get).toBeDefined();
    expect(paths["/api/v1/alerts/rules"]?.post).toBeDefined();
    expect(paths["/api/v1/audit"]?.get).toBeDefined();

    // New — Tier 1: Pipeline lifecycle
    expect(paths["/api/v1/pipelines"]?.post).toBeDefined();
    expect(paths["/api/v1/pipelines/{id}"]?.put).toBeDefined();
    expect(paths["/api/v1/pipelines/{id}"]?.delete).toBeDefined();
    expect(paths["/api/v1/pipelines/{id}/config"]?.get).toBeDefined();
    expect(paths["/api/v1/pipelines/{id}/nodes"]?.post).toBeDefined();
    expect(paths["/api/v1/pipelines/{id}/nodes/{nodeId}"]?.put).toBeDefined();
    expect(paths["/api/v1/pipelines/{id}/nodes/{nodeId}"]?.delete).toBeDefined();
    expect(paths["/api/v1/pipelines/{id}/edges"]?.post).toBeDefined();
    expect(paths["/api/v1/pipelines/{id}/edges/{edgeId}"]?.delete).toBeDefined();
    expect(paths["/api/v1/pipelines/import"]?.post).toBeDefined();

    // New — Tier 2: Fleet & monitoring
    expect(paths["/api/v1/nodes"]?.post).toBeDefined();
    expect(paths["/api/v1/nodes/{id}"]?.delete).toBeDefined();
    expect(paths["/api/v1/nodes/{id}/labels"]?.put).toBeDefined();
    expect(paths["/api/v1/nodes/{id}/metrics"]?.get).toBeDefined();
    expect(paths["/api/v1/pipelines/{id}/metrics"]?.get).toBeDefined();
    expect(paths["/api/v1/pipelines/{id}/logs"]?.get).toBeDefined();
    expect(paths["/api/v1/pipelines/{id}/health"]?.get).toBeDefined();
    expect(paths["/api/v1/fleet/overview"]?.get).toBeDefined();

    // New — Tier 3: Advanced operations
    expect(paths["/api/v1/pipelines/{id}/promote"]?.post).toBeDefined();
    expect(paths["/api/v1/deploy-requests"]?.get).toBeDefined();
    expect(paths["/api/v1/deploy-requests/{id}/approve"]?.post).toBeDefined();
    expect(paths["/api/v1/deploy-requests/{id}/reject"]?.post).toBeDefined();
    expect(paths["/api/v1/node-groups"]?.get).toBeDefined();
    expect(paths["/api/v1/node-groups"]?.post).toBeDefined();
    expect(paths["/api/v1/environments"]?.get).toBeDefined();
  });

  it("every REST v1 operation has a security requirement referencing BearerAuth", () => {
    const spec = generateOpenAPISpec();
    const paths = spec.paths as Record<string, Record<string, unknown>>;

    const restPaths = Object.entries(paths).filter(([path]) => path.startsWith("/api/v1/"));

    for (const [path, methods] of restPaths) {
      for (const [method, operation] of Object.entries(methods)) {
        const op = operation as { security?: Array<Record<string, unknown[]>>; tags?: string[] };
        // Only check REST v1 ops (not tRPC)
        if (op.tags?.includes("tRPC")) continue;
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

  // ─── tRPC procedure tests ───────────────────────────────────────────────────

  it("spec.paths contains tRPC procedure paths under /api/trpc/ prefix", () => {
    const spec = generateOpenAPISpec();
    const paths = spec.paths as Record<string, Record<string, unknown>>;

    const trpcPaths = Object.keys(paths).filter((p) => p.startsWith("/api/trpc/"));
    expect(trpcPaths.length).toBeGreaterThan(0);
    // Spot check a few expected paths
    expect(paths["/api/trpc/pipeline.list"]).toBeDefined();
    expect(paths["/api/trpc/fleet.list"]).toBeDefined();
    expect(paths["/api/trpc/secret.list"]).toBeDefined();
  });

  it("tRPC query procedures map to GET operations, mutations map to POST operations", () => {
    const spec = generateOpenAPISpec();
    const paths = spec.paths as Record<string, Record<string, unknown>>;

    // Queries → GET
    expect(paths["/api/trpc/pipeline.list"]?.get).toBeDefined();
    expect(paths["/api/trpc/pipeline.get"]?.get).toBeDefined();
    expect(paths["/api/trpc/fleet.list"]?.get).toBeDefined();
    expect(paths["/api/trpc/fleet.get"]?.get).toBeDefined();
    expect(paths["/api/trpc/environment.list"]?.get).toBeDefined();
    expect(paths["/api/trpc/secret.list"]?.get).toBeDefined();
    expect(paths["/api/trpc/alert.listRules"]?.get).toBeDefined();
    expect(paths["/api/trpc/serviceAccount.list"]?.get).toBeDefined();

    // Mutations → POST
    expect(paths["/api/trpc/pipeline.create"]?.post).toBeDefined();
    expect(paths["/api/trpc/pipeline.update"]?.post).toBeDefined();
    expect(paths["/api/trpc/pipeline.delete"]?.post).toBeDefined();
    expect(paths["/api/trpc/deploy.agent"]?.post).toBeDefined();
    expect(paths["/api/trpc/deploy.undeploy"]?.post).toBeDefined();
    expect(paths["/api/trpc/secret.create"]?.post).toBeDefined();
    expect(paths["/api/trpc/serviceAccount.create"]?.post).toBeDefined();
  });

  it("tRPC procedure entries include a 'tRPC' tag for grouping", () => {
    const spec = generateOpenAPISpec();
    const paths = spec.paths as Record<string, Record<string, unknown>>;

    const trpcPaths = Object.entries(paths).filter(([p]) => p.startsWith("/api/trpc/"));
    expect(trpcPaths.length).toBeGreaterThan(0);

    for (const [path, methods] of trpcPaths) {
      for (const [, operation] of Object.entries(methods)) {
        const op = operation as { tags?: string[] };
        expect(op.tags, `${path} tRPC operation should have 'tRPC' tag`).toContain("tRPC");
      }
    }
  });

  it("at least 10 tRPC procedures appear in the spec", () => {
    const spec = generateOpenAPISpec();
    const paths = spec.paths as Record<string, Record<string, unknown>>;

    const trpcPaths = Object.keys(paths).filter((p) => p.startsWith("/api/trpc/"));
    expect(trpcPaths.length).toBeGreaterThanOrEqual(10);

    // Specifically verify the 10 required procedures are present
    const required = [
      "/api/trpc/pipeline.list",
      "/api/trpc/pipeline.get",
      "/api/trpc/pipeline.create",
      "/api/trpc/pipeline.delete",
      "/api/trpc/deploy.agent",
      "/api/trpc/fleet.list",
      "/api/trpc/fleet.get",
      "/api/trpc/secret.list",
      "/api/trpc/environment.list",
      "/api/trpc/serviceAccount.list",
    ];

    for (const path of required) {
      expect(paths[path], `Expected tRPC path ${path} to be in spec`).toBeDefined();
    }
  });

  it("tRPC query procedures document the SuperJSON input encoding via ?input= query param", () => {
    const spec = generateOpenAPISpec();
    const paths = spec.paths as Record<string, Record<string, unknown>>;

    const pipelineListOp = paths["/api/trpc/pipeline.list"]?.get as {
      parameters?: Array<{ name: string; in: string; description?: string }>;
    };

    expect(pipelineListOp?.parameters).toBeDefined();
    const inputParam = pipelineListOp?.parameters?.find((p) => p.name === "input");
    expect(inputParam).toBeDefined();
    expect(inputParam?.in).toBe("query");
    // Description should mention SuperJSON or url-encoded
    expect(
      inputParam?.description?.toLowerCase().includes("superjson") ||
      inputParam?.description?.toLowerCase().includes("url-encoded") ||
      inputParam?.description?.toLowerCase().includes("json")
    ).toBe(true);
  });

  it("total operation count (REST v1 + tRPC) exceeds 25", () => {
    const spec = generateOpenAPISpec();
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    const httpMethods = ["get", "post", "put", "delete", "patch", "head", "options"];

    const totalOps = Object.values(paths).reduce((acc, methods) => {
      return acc + Object.keys(methods).filter((m) => httpMethods.includes(m)).length;
    }, 0);

    expect(totalOps).toBeGreaterThan(25);
  });

  it("CookieAuth security scheme is defined", () => {
    const spec = generateOpenAPISpec();
    const components = spec.components as { securitySchemes?: Record<string, unknown> };
    expect(components?.securitySchemes?.CookieAuth).toBeDefined();
  });

  it("tRPC operations use CookieAuth security scheme", () => {
    const spec = generateOpenAPISpec();
    const paths = spec.paths as Record<string, Record<string, unknown>>;

    const trpcPaths = Object.entries(paths).filter(([p]) => p.startsWith("/api/trpc/"));
    expect(trpcPaths.length).toBeGreaterThan(0);

    for (const [path, methods] of trpcPaths) {
      for (const [method, operation] of Object.entries(methods)) {
        const op = operation as { security?: Array<Record<string, unknown[]>> };
        expect(op.security, `${method.toUpperCase()} ${path} should have security`).toBeDefined();
        const secKeys = Object.keys(op.security![0]);
        expect(secKeys, `${method.toUpperCase()} ${path} should use CookieAuth`).toContain("CookieAuth");
      }
    }
  });
});
