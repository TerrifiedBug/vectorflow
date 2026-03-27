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

const cookieAuth = registry.registerComponent("securitySchemes", "CookieAuth", {
  type: "apiKey",
  in: "cookie",
  name: "authjs.session-token",
  description:
    "Session cookie set on sign-in. Used by the VectorFlow web UI and tRPC procedures.",
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
// tRPC — shared helpers
// ---------------------------------------------------------------------------

/**
 * tRPC query (GET) input parameter.
 *
 * For tRPC queries the entire input is URL-encoded as JSON and passed in the
 * `?input=` query parameter using SuperJSON encoding:
 *   GET /api/trpc/<router>.<procedure>?input=<url-encoded-json>
 * where the JSON payload is { "json": <input-object> }.
 */
function trpcInputQueryParam(description: string) {
  return z.string().optional().openapi({
    description: `URL-encoded JSON input (SuperJSON). Encode as \`?input=${encodeURIComponent(JSON.stringify({ json: { "...": "..." } }))}\`. ${description}`,
    example: '{"json":{"environmentId":"clxyz123"}}',
  });
}

/**
 * Standard tRPC response wrapper.
 * All tRPC responses are wrapped in { result: { data: { json: <output> } } }
 */
const TrpcResponseSchema = z
  .object({
    result: z.object({
      data: z.object({
        json: z
          .unknown()
          .openapi({
            description:
              "SuperJSON-encoded response payload. When using tRPC with a TypeScript client the data is automatically deserialized. Raw HTTP callers receive the SuperJSON wire format.",
          }),
      }),
    }),
  })
  .openapi("TrpcResponse");

/**
 * Standard tRPC error response.
 */
const TrpcErrorSchema = z
  .object({
    error: z.object({
      json: z.object({
        message: z.string().openapi({ example: "Pipeline not found" }),
        code: z.number().openapi({ example: -32004 }),
        data: z.object({
          code: z.string().openapi({ example: "NOT_FOUND" }),
          httpStatus: z.number().openapi({ example: 404 }),
        }),
      }),
    }),
  })
  .openapi("TrpcError");

const trpcSecurity = [{ [cookieAuth.name]: [] }];

const trpcNote =
  "**tRPC endpoint.** Auth: session cookie (`authjs.session-token`). Uses SuperJSON encoding. " +
  "For full type safety and automatic deserialization use the TypeScript tRPC client.";

// ---------------------------------------------------------------------------
// tRPC — Pipeline procedures
// ---------------------------------------------------------------------------

// pipeline.list (query → GET)
registry.registerPath({
  method: "get",
  path: "/api/trpc/pipeline.list",
  operationId: "trpcPipelineList",
  summary: "pipeline.list — List pipelines",
  description: `${trpcNote}\n\nReturns all pipelines in an environment.`,
  tags: ["tRPC"],
  security: trpcSecurity,
  request: {
    query: z.object({
      input: trpcInputQueryParam("Required fields: `environmentId: string`"),
    }),
  },
  responses: {
    200: {
      description: "List of pipelines",
      content: { "application/json": { schema: TrpcResponseSchema } },
    },
    401: { description: "Unauthorized — not signed in" },
    403: { description: "Forbidden — insufficient role" },
  },
});

// pipeline.get (query → GET)
registry.registerPath({
  method: "get",
  path: "/api/trpc/pipeline.get",
  operationId: "trpcPipelineGet",
  summary: "pipeline.get — Get pipeline",
  description: `${trpcNote}\n\nReturns a single pipeline with its node graph, edges, and config change status.`,
  tags: ["tRPC"],
  security: trpcSecurity,
  request: {
    query: z.object({
      input: trpcInputQueryParam("Required fields: `id: string`"),
    }),
  },
  responses: {
    200: {
      description: "Pipeline detail",
      content: { "application/json": { schema: TrpcResponseSchema } },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
    404: { description: "Pipeline not found", content: { "application/json": { schema: TrpcErrorSchema } } },
  },
});

// pipeline.create (mutation → POST)
registry.registerPath({
  method: "post",
  path: "/api/trpc/pipeline.create",
  operationId: "trpcPipelineCreate",
  summary: "pipeline.create — Create pipeline",
  description: `${trpcNote}\n\nCreates a new draft pipeline.`,
  tags: ["tRPC"],
  security: trpcSecurity,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            json: z.object({
              name: z.string().openapi({
                example: "syslog-to-s3",
                description: "Must match `^[a-zA-Z0-9][a-zA-Z0-9 _-]*$`, 1–100 characters.",
              }),
              description: z.string().optional().openapi({ example: "Ships syslog to S3" }),
              environmentId: z.string().openapi({ example: "clxyz123" }),
            }),
          }).openapi({ description: "SuperJSON mutation body: `{\"json\": <input>}`" }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Created pipeline",
      content: { "application/json": { schema: TrpcResponseSchema } },
    },
    400: { description: "Invalid input or name format", content: { "application/json": { schema: TrpcErrorSchema } } },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden — minimum role: EDITOR" },
    404: { description: "Environment not found", content: { "application/json": { schema: TrpcErrorSchema } } },
  },
});

// pipeline.update (mutation → POST)
registry.registerPath({
  method: "post",
  path: "/api/trpc/pipeline.update",
  operationId: "trpcPipelineUpdate",
  summary: "pipeline.update — Update pipeline",
  description: `${trpcNote}\n\nUpdates pipeline name or description.`,
  tags: ["tRPC"],
  security: trpcSecurity,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            json: z.object({
              id: z.string().openapi({ example: "clxyz123" }),
              name: z.string().optional().openapi({ example: "updated-name" }),
              description: z.string().nullable().optional().openapi({ example: "Updated description" }),
            }),
          }).openapi({ description: "SuperJSON mutation body." }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Updated pipeline",
      content: { "application/json": { schema: TrpcResponseSchema } },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden — minimum role: EDITOR" },
    404: { description: "Pipeline not found", content: { "application/json": { schema: TrpcErrorSchema } } },
  },
});

// pipeline.delete (mutation → POST)
registry.registerPath({
  method: "post",
  path: "/api/trpc/pipeline.delete",
  operationId: "trpcPipelineDelete",
  summary: "pipeline.delete — Delete pipeline",
  description: `${trpcNote}\n\nDeletes a pipeline (undeploys first if deployed).`,
  tags: ["tRPC"],
  security: trpcSecurity,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            json: z.object({
              id: z.string().openapi({ example: "clxyz123" }),
            }),
          }).openapi({ description: "SuperJSON mutation body." }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Deletion result",
      content: { "application/json": { schema: TrpcResponseSchema } },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden — minimum role: EDITOR" },
    404: { description: "Pipeline not found", content: { "application/json": { schema: TrpcErrorSchema } } },
  },
});

// ---------------------------------------------------------------------------
// tRPC — Deploy procedures
// ---------------------------------------------------------------------------

// deploy.agent (mutation → POST)
registry.registerPath({
  method: "post",
  path: "/api/trpc/deploy.agent",
  operationId: "trpcDeployAgent",
  summary: "deploy.agent — Deploy pipeline to agents",
  description:
    `${trpcNote}\n\nValidates the pipeline config, creates a new version, and marks it as deployed. ` +
    "Fleet agents pick up the change on their next poll. If the environment requires deploy approval and the caller is an EDITOR (not ADMIN), " +
    "a deploy request is created instead of deploying directly.",
  tags: ["tRPC"],
  security: trpcSecurity,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            json: z.object({
              pipelineId: z.string().openapi({ example: "clxyz123" }),
              changelog: z.string().min(1).openapi({ example: "Deployed from CI" }),
              nodeSelector: z
                .record(z.string(), z.string())
                .optional()
                .openapi({
                  description: "Optional key/value label filter to target a subset of fleet nodes.",
                  example: { env: "production" },
                }),
            }),
          }).openapi({ description: "SuperJSON mutation body." }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Deployment result or deploy request created",
      content: { "application/json": { schema: TrpcResponseSchema } },
    },
    400: { description: "Invalid pipeline config", content: { "application/json": { schema: TrpcErrorSchema } } },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden — minimum role: EDITOR" },
    404: { description: "Pipeline not found", content: { "application/json": { schema: TrpcErrorSchema } } },
  },
});

// deploy.undeploy (mutation → POST)
registry.registerPath({
  method: "post",
  path: "/api/trpc/deploy.undeploy",
  operationId: "trpcDeployUndeploy",
  summary: "deploy.undeploy — Undeploy pipeline",
  description: `${trpcNote}\n\nStops a deployed pipeline on all fleet nodes (agents stop it on their next poll).`,
  tags: ["tRPC"],
  security: trpcSecurity,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            json: z.object({
              pipelineId: z.string().openapi({ example: "clxyz123" }),
            }),
          }).openapi({ description: "SuperJSON mutation body." }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Undeploy result",
      content: { "application/json": { schema: TrpcResponseSchema } },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden — minimum role: EDITOR" },
    404: { description: "Pipeline not found", content: { "application/json": { schema: TrpcErrorSchema } } },
  },
});

// ---------------------------------------------------------------------------
// tRPC — Fleet procedures
// ---------------------------------------------------------------------------

// fleet.list (query → GET)
registry.registerPath({
  method: "get",
  path: "/api/trpc/fleet.list",
  operationId: "trpcFleetList",
  summary: "fleet.list — List fleet nodes",
  description: `${trpcNote}\n\nReturns all fleet nodes in an environment. Optionally filter by search term, status, or labels.`,
  tags: ["tRPC"],
  security: trpcSecurity,
  request: {
    query: z.object({
      input: trpcInputQueryParam(
        "Required: `environmentId: string`. Optional: `search?: string`, `status?: string[]`, `labels?: Record<string,string>`",
      ),
    }),
  },
  responses: {
    200: {
      description: "List of fleet nodes",
      content: { "application/json": { schema: TrpcResponseSchema } },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
  },
});

// fleet.get (query → GET)
registry.registerPath({
  method: "get",
  path: "/api/trpc/fleet.get",
  operationId: "trpcFleetGet",
  summary: "fleet.get — Get fleet node",
  description: `${trpcNote}\n\nReturns a single fleet node with its pipeline deployment statuses.`,
  tags: ["tRPC"],
  security: trpcSecurity,
  request: {
    query: z.object({
      input: trpcInputQueryParam("Required fields: `id: string`"),
    }),
  },
  responses: {
    200: {
      description: "Fleet node detail",
      content: { "application/json": { schema: TrpcResponseSchema } },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
    404: { description: "Node not found", content: { "application/json": { schema: TrpcErrorSchema } } },
  },
});

// ---------------------------------------------------------------------------
// tRPC — Environment procedures
// ---------------------------------------------------------------------------

// environment.list (query → GET)
registry.registerPath({
  method: "get",
  path: "/api/trpc/environment.list",
  operationId: "trpcEnvironmentList",
  summary: "environment.list — List environments",
  description: `${trpcNote}\n\nReturns all environments for a team.`,
  tags: ["tRPC"],
  security: trpcSecurity,
  request: {
    query: z.object({
      input: trpcInputQueryParam("Required fields: `teamId: string`"),
    }),
  },
  responses: {
    200: {
      description: "List of environments",
      content: { "application/json": { schema: TrpcResponseSchema } },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
  },
});

// ---------------------------------------------------------------------------
// tRPC — Secret procedures
// ---------------------------------------------------------------------------

// secret.list (query → GET)
registry.registerPath({
  method: "get",
  path: "/api/trpc/secret.list",
  operationId: "trpcSecretList",
  summary: "secret.list — List secrets",
  description: `${trpcNote}\n\nReturns secret metadata (id, name, timestamps) for all secrets in an environment. Secret values are never returned.`,
  tags: ["tRPC"],
  security: trpcSecurity,
  request: {
    query: z.object({
      input: trpcInputQueryParam("Required fields: `environmentId: string`"),
    }),
  },
  responses: {
    200: {
      description: "List of secret metadata",
      content: { "application/json": { schema: TrpcResponseSchema } },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
  },
});

// secret.create (mutation → POST)
registry.registerPath({
  method: "post",
  path: "/api/trpc/secret.create",
  operationId: "trpcSecretCreate",
  summary: "secret.create — Create secret",
  description: `${trpcNote}\n\nCreates a new encrypted secret in an environment.`,
  tags: ["tRPC"],
  security: trpcSecurity,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            json: z.object({
              environmentId: z.string().openapi({ example: "clxyz123" }),
              name: z.string().openapi({
                example: "DATABASE_PASSWORD",
                description: "Must match `^[a-zA-Z0-9][a-zA-Z0-9_-]*$`",
              }),
              value: z.string().min(1).openapi({ example: "supersecret123" }),
            }),
          }).openapi({ description: "SuperJSON mutation body." }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Created secret metadata",
      content: { "application/json": { schema: TrpcResponseSchema } },
    },
    400: { description: "Invalid name format", content: { "application/json": { schema: TrpcErrorSchema } } },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden — minimum role: EDITOR" },
    409: { description: "Secret name already exists", content: { "application/json": { schema: TrpcErrorSchema } } },
  },
});

// ---------------------------------------------------------------------------
// tRPC — Alert procedures
// ---------------------------------------------------------------------------

// alert.listRules (query → GET)
registry.registerPath({
  method: "get",
  path: "/api/trpc/alert.listRules",
  operationId: "trpcAlertListRules",
  summary: "alert.listRules — List alert rules",
  description: `${trpcNote}\n\nReturns all alert rules for an environment.`,
  tags: ["tRPC"],
  security: trpcSecurity,
  request: {
    query: z.object({
      input: trpcInputQueryParam("Required fields: `environmentId: string`"),
    }),
  },
  responses: {
    200: {
      description: "List of alert rules",
      content: { "application/json": { schema: TrpcResponseSchema } },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden" },
  },
});

// ---------------------------------------------------------------------------
// tRPC — Service Account procedures
// ---------------------------------------------------------------------------

// serviceAccount.list (query → GET)
registry.registerPath({
  method: "get",
  path: "/api/trpc/serviceAccount.list",
  operationId: "trpcServiceAccountList",
  summary: "serviceAccount.list — List service accounts",
  description: `${trpcNote}\n\nReturns all service accounts for an environment. Minimum role: ADMIN.`,
  tags: ["tRPC"],
  security: trpcSecurity,
  request: {
    query: z.object({
      input: trpcInputQueryParam("Required fields: `environmentId: string`"),
    }),
  },
  responses: {
    200: {
      description: "List of service accounts",
      content: { "application/json": { schema: TrpcResponseSchema } },
    },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden — minimum role: ADMIN" },
  },
});

// serviceAccount.create (mutation → POST)
registry.registerPath({
  method: "post",
  path: "/api/trpc/serviceAccount.create",
  operationId: "trpcServiceAccountCreate",
  summary: "serviceAccount.create — Create service account",
  description:
    `${trpcNote}\n\nCreates a new service account and returns the raw API key (shown once only). ` +
    "Minimum role: ADMIN.",
  tags: ["tRPC"],
  security: trpcSecurity,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            json: z.object({
              environmentId: z.string().openapi({ example: "clxyz123" }),
              name: z.string().min(1).max(100).openapi({ example: "ci-deployer" }),
              description: z.string().max(500).optional().openapi({ example: "CI/CD deployment account" }),
              permissions: z.array(
                z.enum([
                  "pipelines.read",
                  "pipelines.deploy",
                  "nodes.read",
                  "nodes.manage",
                  "secrets.read",
                  "secrets.manage",
                  "alerts.read",
                  "alerts.manage",
                  "audit.read",
                ]).openapi({}),
              ).min(1).openapi({ example: ["pipelines.read", "pipelines.deploy"] }),
              expiresInDays: z.number().int().min(1).optional().openapi({ example: 365 }),
            }),
          }).openapi({ description: "SuperJSON mutation body." }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Created service account with raw API key (shown once)",
      content: { "application/json": { schema: TrpcResponseSchema } },
    },
    400: { description: "Invalid input", content: { "application/json": { schema: TrpcErrorSchema } } },
    401: { description: "Unauthorized" },
    403: { description: "Forbidden — minimum role: ADMIN" },
    409: { description: "Service account name already exists", content: { "application/json": { schema: TrpcErrorSchema } } },
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
