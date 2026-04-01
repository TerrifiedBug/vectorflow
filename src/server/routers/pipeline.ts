/**
 * Pipeline router — thin re-export that merges all pipeline sub-routers.
 *
 * The tRPC client API is unchanged: all procedures remain at `trpc.pipeline.<procedureName>`.
 * Implementation lives in the focused sub-router files:
 *   - pipeline-crud.ts          — list, get, create, update, delete, clone, promote
 *   - pipeline-versions.ts      — versions, versionsSummary, createVersion, getVersion, rollback
 *   - pipeline-graph.ts         — saveGraph, discardChanges
 *   - pipeline-deploy.ts        — deploymentStatus, deployBatch, bulkUndeploy
 *   - pipeline-observability.ts — metrics, logs, requestSamples, sampleResult, eventSchemas, SLIs, health
 *   - pipeline-bulk.ts          — bulkDelete, bulkAddTags, bulkRemoveTags
 *
 * Shared schemas (pipelineNameSchema, nodeSchema, edgeSchema) live in pipeline-schemas.ts.
 */

import { router } from "@/trpc/init";
import { pipelineCrudRouter } from "./pipeline-crud";
import { pipelineVersionsRouter } from "./pipeline-versions";
import { pipelineGraphRouter } from "./pipeline-graph";
import { pipelineDeployRouter } from "./pipeline-deploy";
import { pipelineObservabilityRouter } from "./pipeline-observability";
import { pipelineBulkRouter } from "./pipeline-bulk";

export const pipelineRouter = router({
  ...pipelineCrudRouter._def.procedures,
  ...pipelineVersionsRouter._def.procedures,
  ...pipelineGraphRouter._def.procedures,
  ...pipelineDeployRouter._def.procedures,
  ...pipelineObservabilityRouter._def.procedures,
  ...pipelineBulkRouter._def.procedures,
});
