import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

// IMPORTANT: Must be called before any z.object(...) calls
extendZodWithOpenApi(z);

// ---------------------------------------------------------------------------
// Registry bootstrap
// ---------------------------------------------------------------------------

const registry = new OpenAPIRegistry();

const bearerAuth = registry.registerComponent("securitySchemes", "BearerAuth", {
  type: "http",
  scheme: "bearer",
  description:
    "Service account API key. Format: Authorization: Bearer vf_<key>. Service accounts are environment-scoped.",
});

// ---------------------------------------------------------------------------
// Shared error schemas
// ---------------------------------------------------------------------------

const ErrorResponse = z
  .object({
    error: z.string().openapi({ example: "Not found" }),
  })
  .openapi("ErrorResponse");

const ValidationErrorResponse = z
  .object({
    error: z.string().openapi({ example: "Deployment failed" }),
    validationErrors: z.array(z.string()).optional(),
  })
  .openapi("ValidationErrorResponse");

// ---------------------------------------------------------------------------
// Pipelines — shared schemas
// ---------------------------------------------------------------------------

const PipelineSchema = z
  .object({
    id: z.string().openapi({ example: "clxyz123abc" }),
    name: z.string().openapi({ example: "my-pipeline" }),
    description: z.string().nullable().openapi({ example: "Collects nginx logs" }),
    isDraft: z.boolean().openapi({ example: false }),
    deployedAt: z
      .string()
      .nullable()
      .openapi({ example: "2024-01-15T10:00:00Z", format: "date-time" }),
    createdAt: z.string().openapi({ example: "2024-01-01T00:00:00Z", format: "date-time" }),
    updatedAt: z.string().openapi({ example: "2024-01-15T10:00:00Z", format: "date-time" }),
  })
  .openapi("Pipeline");

const PipelineNodeSchema = z
  .object({
    id: z.string(),
    componentKey: z.string().openapi({ example: "vector.sources.file" }),
    componentType: z.string().openapi({ example: "source" }),
    kind: z.string().openapi({ example: "source" }),
    positionX: z.number(),
    positionY: z.number(),
    disabled: z.boolean(),
  })
  .openapi("PipelineNode");

const PipelineEdgeSchema = z
  .object({
    id: z.string(),
    sourceNodeId: z.string(),
    targetNodeId: z.string(),
    sourcePort: z.string().nullable(),
  })
  .openapi("PipelineEdge");

const PipelineNodeStatusSchema = z
  .object({
    nodeId: z.string(),
    status: z.string().openapi({ example: "running" }),
    version: z.string().nullable(),
    eventsIn: z.number().nullable(),
    eventsOut: z.number().nullable(),
    errorsTotal: z.number().nullable(),
  })
  .openapi("PipelineNodeStatus");

const PipelineDetailSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    isDraft: z.boolean(),
    deployedAt: z.string().nullable().openapi({ format: "date-time" }),
    environmentId: z.string(),
    createdAt: z.string().openapi({ format: "date-time" }),
    updatedAt: z.string().openapi({ format: "date-time" }),
    nodes: z.array(PipelineNodeSchema),
    edges: z.array(PipelineEdgeSchema),
    nodeStatuses: z.array(PipelineNodeStatusSchema),
  })
  .openapi("PipelineDetail");

const PipelineVersionSchema = z
  .object({
    id: z.string(),
    version: z.number().openapi({ example: 3 }),
    changelog: z.string().nullable().openapi({ example: "Deployed via REST API" }),
    createdById: z.string().nullable(),
    createdAt: z.string().openapi({ format: "date-time" }),
  })
  .openapi("PipelineVersion");

// ---------------------------------------------------------------------------
// Nodes — shared schemas
// ---------------------------------------------------------------------------

const NodeEnvironmentSchema = z
  .object({
    id: z.string(),
    name: z.string().openapi({ example: "production" }),
  })
  .openapi("NodeEnvironment");

const NodeSchema = z
  .object({
    id: z.string(),
    name: z.string().openapi({ example: "node-prod-01" }),
    host: z.string().openapi({ example: "10.0.1.50" }),
    apiPort: z.number().openapi({ example: 8686 }),
    environmentId: z.string(),
    status: z.string().openapi({ example: "online" }),
    lastSeen: z.string().nullable().openapi({ format: "date-time" }),
    lastHeartbeat: z.string().nullable().openapi({ format: "date-time" }),
    agentVersion: z.string().nullable().openapi({ example: "0.9.1" }),
    vectorVersion: z.string().nullable().openapi({ example: "0.43.0" }),
    os: z.string().nullable().openapi({ example: "linux" }),
    deploymentMode: z.string().nullable().openapi({ example: "docker" }),
    maintenanceMode: z.boolean(),
    maintenanceModeAt: z.string().nullable().openapi({ format: "date-time" }),
    metadata: z.record(z.unknown()).nullable(),
    enrolledAt: z.string().nullable().openapi({ format: "date-time" }),
    createdAt: z.string().openapi({ format: "date-time" }),
    environment: NodeEnvironmentSchema,
  })
  .openapi("Node");

const NodePipelineStatusSchema = z
  .object({
    id: z.string(),
    status: z.string().openapi({ example: "running" }),
    pipeline: z.object({
      id: z.string(),
      name: z.string(),
    }),
  })
  .openapi("NodePipelineStatus");

const NodeDetailSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    host: z.string(),
    apiPort: z.number(),
    environmentId: z.string(),
    status: z.string(),
    lastSeen: z.string().nullable().openapi({ format: "date-time" }),
    lastHeartbeat: z.string().nullable().openapi({ format: "date-time" }),
    agentVersion: z.string().nullable(),
    vectorVersion: z.string().nullable(),
    os: z.string().nullable(),
    deploymentMode: z.string().nullable(),
    maintenanceMode: z.boolean(),
    maintenanceModeAt: z.string().nullable().openapi({ format: "date-time" }),
    metadata: z.record(z.unknown()).nullable(),
    enrolledAt: z.string().nullable().openapi({ format: "date-time" }),
    createdAt: z.string().openapi({ format: "date-time" }),
    environment: NodeEnvironmentSchema,
    pipelineStatuses: z.array(NodePipelineStatusSchema),
  })
  .openapi("NodeDetail");

const NodeMaintenanceResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    maintenanceMode: z.boolean(),
    maintenanceModeAt: z.string().nullable().openapi({ format: "date-time" }),
  })
  .openapi("NodeMaintenanceResponse");

// ---------------------------------------------------------------------------
// Secrets — shared schemas
// ---------------------------------------------------------------------------

const SecretMetaSchema = z
  .object({
    id: z.string(),
    name: z.string().openapi({ example: "DATABASE_PASSWORD" }),
    createdAt: z.string().openapi({ format: "date-time" }),
    updatedAt: z.string().openapi({ format: "date-time" }),
  })
  .openapi("SecretMeta");

const SecretUpdatedSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    updatedAt: z.string().openapi({ format: "date-time" }),
  })
  .openapi("SecretUpdated");

// ---------------------------------------------------------------------------
// Alert Rules — shared schemas
// ---------------------------------------------------------------------------

const AlertMetric = z
  .enum([
    "node_unreachable",
    "cpu_usage",
    "memory_usage",
    "disk_usage",
    "error_rate",
    "discarded_rate",
    "pipeline_crashed",
    "fleet_error_rate",
    "fleet_throughput_drop",
    "fleet_event_volume",
    "node_load_imbalance",
  ])
  .openapi("AlertMetric");

const AlertCondition = z.enum(["gt", "lt", "eq"]).openapi("AlertCondition");

const AlertRuleSchema = z
  .object({
    id: z.string(),
    name: z.string().openapi({ example: "High CPU Usage" }),
    environmentId: z.string(),
    teamId: z.string(),
    pipelineId: z.string().nullable(),
    metric: AlertMetric,
    condition: AlertCondition,
    threshold: z.number().openapi({ example: 90 }),
    durationSeconds: z.number().openapi({ example: 60 }),
    createdAt: z.string().openapi({ format: "date-time" }),
    updatedAt: z.string().openapi({ format: "date-time" }),
    pipeline: z
      .object({
        id: z.string(),
        name: z.string(),
      })
      .nullable(),
  })
  .openapi("AlertRule");

// ---------------------------------------------------------------------------
// Audit — shared schemas
// ---------------------------------------------------------------------------

const AuditEventSchema = z
  .object({
    id: z.string(),
    action: z.string().openapi({ example: "api.pipeline_deployed" }),
    entityType: z.string().nullable(),
    entityId: z.string().nullable(),
    createdAt: z.string().openapi({ format: "date-time" }),
    user: z
      .object({
        id: z.string(),
        name: z.string().nullable(),
        email: z.string(),
      })
      .nullable(),
  })
  .openapi("AuditEvent");

// ---------------------------------------------------------------------------
// Register all 16 paths
// ---------------------------------------------------------------------------

// 1. GET /api/v1/pipelines
registry.registerPath({
  method: "get",
  path: "/api/v1/pipelines",
  operationId: "listPipelines",
  summary: "List pipelines",
  description:
    "Returns all pipelines in the environment associated with the service account, ordered by most recently updated.",
  tags: ["Pipelines"],
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: {
      description: "List of pipelines",
      content: {
        "application/json": {
          schema: z.object({ pipelines: z.array(PipelineSchema) }),
        },
      },
    },
    401: { description: "Unauthorized — invalid or missing API key" },
    403: { description: "Forbidden — service account lacks pipelines.read permission" },
  },
});

// 2. GET /api/v1/pipelines/{id}
registry.registerPath({
  method: "get",
  path: "/api/v1/pipelines/{id}",
  operationId: "getPipeline",
  summary: "Get pipeline",
  description:
    "Returns a single pipeline with its node graph, edges, and current node statuses.",
  tags: ["Pipelines"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({ description: "Pipeline ID" }),
    }),
  },
  responses: {
    200: {
      description: "Pipeline detail",
      content: {
        "application/json": {
          schema: z.object({ pipeline: PipelineDetailSchema }),
        },
      },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
    404: {
      description: "Pipeline not found",
      content: {
        "application/json": {
          schema: ErrorResponse,
        },
      },
    },
  },
});

// 3. POST /api/v1/pipelines/{id}/deploy
registry.registerPath({
  method: "post",
  path: "/api/v1/pipelines/{id}/deploy",
  operationId: "deployPipeline",
  summary: "Deploy pipeline",
  description:
    "Creates a new pipeline version and deploys it to all matching fleet nodes. Returns the version ID and version number on success.",
  tags: ["Pipelines"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({ description: "Pipeline ID" }),
    }),
    body: {
      required: false,
      content: {
        "application/json": {
          schema: z.object({
            changelog: z
              .string()
              .optional()
              .openapi({ example: "Deployed via CI/CD pipeline" }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Deployment successful",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            versionId: z.string(),
            versionNumber: z.number(),
          }),
        },
      },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
    404: {
      description: "Pipeline not found",
      content: { "application/json": { schema: ErrorResponse } },
    },
    422: {
      description: "Deployment failed — validation errors in pipeline config",
      content: {
        "application/json": {
          schema: ValidationErrorResponse,
        },
      },
    },
  },
});

// 4. POST /api/v1/pipelines/{id}/rollback
registry.registerPath({
  method: "post",
  path: "/api/v1/pipelines/{id}/rollback",
  operationId: "rollbackPipeline",
  summary: "Rollback pipeline",
  description:
    "Rolls back the pipeline to a specific previously deployed version.",
  tags: ["Pipelines"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({ description: "Pipeline ID" }),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            targetVersionId: z
              .string()
              .openapi({ description: "ID of the version to roll back to" }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Rollback successful",
      content: {
        "application/json": {
          schema: z.object({
            success: z.literal(true),
            versionId: z.string(),
            versionNumber: z.number(),
          }),
        },
      },
    },
    400: {
      description: "Missing or invalid targetVersionId",
      content: { "application/json": { schema: ErrorResponse } },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
    404: {
      description: "Pipeline not found",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

// 5. POST /api/v1/pipelines/{id}/undeploy
registry.registerPath({
  method: "post",
  path: "/api/v1/pipelines/{id}/undeploy",
  operationId: "undeployPipeline",
  summary: "Undeploy pipeline",
  description: "Stops a deployed pipeline on all fleet nodes.",
  tags: ["Pipelines"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({ description: "Pipeline ID" }),
    }),
  },
  responses: {
    200: {
      description: "Undeployment result",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
          }),
        },
      },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
    404: {
      description: "Pipeline not found",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

// 6. GET /api/v1/pipelines/{id}/versions
registry.registerPath({
  method: "get",
  path: "/api/v1/pipelines/{id}/versions",
  operationId: "listPipelineVersions",
  summary: "List pipeline versions",
  description: "Returns all saved versions of a pipeline, ordered by version number descending.",
  tags: ["Pipelines"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({ description: "Pipeline ID" }),
    }),
  },
  responses: {
    200: {
      description: "Pipeline versions",
      content: {
        "application/json": {
          schema: z.object({ versions: z.array(PipelineVersionSchema) }),
        },
      },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
    404: {
      description: "Pipeline not found",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

// 7. GET /api/v1/nodes
registry.registerPath({
  method: "get",
  path: "/api/v1/nodes",
  operationId: "listNodes",
  summary: "List nodes",
  description:
    "Returns all fleet nodes in the environment. Optionally filter by label using the `label` query parameter in `key:value` format.",
  tags: ["Nodes"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    query: z.object({
      label: z
        .string()
        .optional()
        .openapi({ example: "env:production", description: "Filter nodes by label in key:value format" }),
    }),
  },
  responses: {
    200: {
      description: "List of nodes",
      content: {
        "application/json": {
          schema: z.object({ nodes: z.array(NodeSchema) }),
        },
      },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
  },
});

// 8. GET /api/v1/nodes/{id}
registry.registerPath({
  method: "get",
  path: "/api/v1/nodes/{id}",
  operationId: "getNode",
  summary: "Get node",
  description: "Returns a single node with its pipeline deployment statuses.",
  tags: ["Nodes"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({ description: "Node ID" }),
    }),
  },
  responses: {
    200: {
      description: "Node detail",
      content: {
        "application/json": {
          schema: z.object({ node: NodeDetailSchema }),
        },
      },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
    404: {
      description: "Node not found",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

// 9. POST /api/v1/nodes/{id}/maintenance
registry.registerPath({
  method: "post",
  path: "/api/v1/nodes/{id}/maintenance",
  operationId: "toggleMaintenance",
  summary: "Toggle maintenance mode",
  description:
    "Enable or disable maintenance mode on a node. Nodes in maintenance mode stop receiving new deployments.",
  tags: ["Nodes"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({
      id: z.string().openapi({ description: "Node ID" }),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            enabled: z.boolean().openapi({ description: "true to enable maintenance mode, false to disable" }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Updated maintenance mode state",
      content: {
        "application/json": {
          schema: z.object({ node: NodeMaintenanceResponseSchema }),
        },
      },
    },
    400: {
      description: "Invalid request body",
      content: { "application/json": { schema: ErrorResponse } },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
    404: {
      description: "Node not found",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

// 10. GET /api/v1/secrets
registry.registerPath({
  method: "get",
  path: "/api/v1/secrets",
  operationId: "listSecrets",
  summary: "List secrets",
  description:
    "Returns metadata (id, name, timestamps) for all secrets in the environment. Secret values are never returned.",
  tags: ["Secrets"],
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: {
      description: "List of secret metadata",
      content: {
        "application/json": {
          schema: z.object({ secrets: z.array(SecretMetaSchema) }),
        },
      },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
  },
});

// 11. POST /api/v1/secrets
registry.registerPath({
  method: "post",
  path: "/api/v1/secrets",
  operationId: "createSecret",
  summary: "Create secret",
  description:
    "Creates a new encrypted secret. Name must start with a letter or number and contain only letters, numbers, hyphens, and underscores.",
  tags: ["Secrets"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            name: z
              .string()
              .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
              .openapi({ example: "DATABASE_PASSWORD" }),
            value: z.string().openapi({ example: "supersecret123" }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Secret created",
      content: {
        "application/json": {
          schema: z.object({ secret: SecretMetaSchema }),
        },
      },
    },
    400: {
      description: "Invalid request body or name format",
      content: { "application/json": { schema: ErrorResponse } },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
    409: {
      description: "A secret with this name already exists",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

// 12. PUT /api/v1/secrets
registry.registerPath({
  method: "put",
  path: "/api/v1/secrets",
  operationId: "updateSecret",
  summary: "Update secret",
  description:
    "Updates the value of an existing secret. Identify the secret by id or name (one required).",
  tags: ["Secrets"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            id: z.string().optional().openapi({ description: "Secret ID (id or name required)" }),
            name: z.string().optional().openapi({ description: "Secret name (id or name required)" }),
            value: z.string().openapi({ example: "newsecretvalue" }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Secret updated",
      content: {
        "application/json": {
          schema: z.object({ secret: SecretUpdatedSchema }),
        },
      },
    },
    400: {
      description: "Missing id or name, or missing value",
      content: { "application/json": { schema: ErrorResponse } },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
    404: {
      description: "Secret not found",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

// 13. DELETE /api/v1/secrets
registry.registerPath({
  method: "delete",
  path: "/api/v1/secrets",
  operationId: "deleteSecret",
  summary: "Delete secret",
  description:
    "Deletes a secret by id or name query parameter (one required).",
  tags: ["Secrets"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    query: z.object({
      id: z.string().optional().openapi({ description: "Secret ID" }),
      name: z.string().optional().openapi({ description: "Secret name" }),
    }),
  },
  responses: {
    200: {
      description: "Secret deleted",
      content: {
        "application/json": {
          schema: z.object({ deleted: z.literal(true) }),
        },
      },
    },
    400: {
      description: "Neither id nor name provided",
      content: { "application/json": { schema: ErrorResponse } },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
    404: {
      description: "Secret not found",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

// 14. GET /api/v1/alerts/rules
registry.registerPath({
  method: "get",
  path: "/api/v1/alerts/rules",
  operationId: "listAlertRules",
  summary: "List alert rules",
  description: "Returns all alert rules in the environment, ordered by most recently created.",
  tags: ["Alerts"],
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: {
      description: "List of alert rules",
      content: {
        "application/json": {
          schema: z.object({ rules: z.array(AlertRuleSchema) }),
        },
      },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
  },
});

// 15. POST /api/v1/alerts/rules
registry.registerPath({
  method: "post",
  path: "/api/v1/alerts/rules",
  operationId: "createAlertRule",
  summary: "Create alert rule",
  description:
    "Creates a new alert rule. Fleet-scoped metrics (fleet_error_rate, fleet_throughput_drop, fleet_event_volume, node_load_imbalance) cannot be scoped to a specific pipeline.",
  tags: ["Alerts"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().openapi({ example: "High CPU Usage" }),
            metric: AlertMetric,
            condition: AlertCondition,
            threshold: z.number().openapi({ example: 90 }),
            pipelineId: z
              .string()
              .optional()
              .openapi({ description: "Scope rule to a specific pipeline. Not allowed for fleet metrics." }),
            durationSeconds: z
              .number()
              .optional()
              .openapi({ example: 60, description: "Duration the condition must persist before firing. Defaults to 60." }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Alert rule created",
      content: {
        "application/json": {
          schema: z.object({ rule: AlertRuleSchema }),
        },
      },
    },
    400: {
      description: "Invalid request body or metric/condition combination",
      content: { "application/json": { schema: ErrorResponse } },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
    404: {
      description: "Pipeline not found",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

// 16. GET /api/v1/audit
registry.registerPath({
  method: "get",
  path: "/api/v1/audit",
  operationId: "listAuditEvents",
  summary: "List audit events",
  description:
    "Returns audit log events for the environment with cursor-based pagination. Events are ordered by creation time ascending.",
  tags: ["Audit"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    query: z.object({
      after: z
        .string()
        .optional()
        .openapi({ description: "Pagination cursor — ID of the last event from the previous page" }),
      limit: z
        .string()
        .optional()
        .openapi({ example: "50", description: "Number of events to return (1–200, default 50)" }),
      action: z
        .string()
        .optional()
        .openapi({ example: "api.pipeline_deployed", description: "Filter by action type" }),
    }),
  },
  responses: {
    200: {
      description: "Audit events page",
      content: {
        "application/json": {
          schema: z.object({
            events: z.array(AuditEventSchema),
            cursor: z.string().nullable().openapi({ description: "Cursor for the next page" }),
            hasMore: z.boolean(),
          }),
        },
      },
    },
    400: {
      description: "Invalid cursor",
      content: { "application/json": { schema: ErrorResponse } },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
  },
});

// ---------------------------------------------------------------------------
// Generator function
// ---------------------------------------------------------------------------

let _cachedSpec: ReturnType<OpenApiGeneratorV31["generateDocument"]> | null = null;

/**
 * Generates (and caches) the OpenAPI 3.1 specification document for all
 * VectorFlow REST v1 endpoints.
 */
export function generateOpenAPISpec() {
  if (_cachedSpec) return _cachedSpec;

  const generator = new OpenApiGeneratorV31(registry.definitions);
  _cachedSpec = generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "VectorFlow REST API",
      version: "1.0.0",
      description:
        "REST API for managing Vector data pipelines, fleet nodes, secrets, and alerts in VectorFlow.",
    },
    servers: [
      {
        url: "/api/v1",
        description: "VectorFlow REST API v1",
      },
    ],
  });

  return _cachedSpec;
}
