import { z } from "zod";

export const deploymentModeSchema = z.enum(["STANDALONE", "DOCKER", "UNKNOWN"]);

export const certFileSchema = z.object({
  name: z.string().min(1),
  filename: z.string().min(1),
  data: z.string().min(1),
});

export const sampleRequestSchema = z.object({
  requestId: z.string().min(1),
  pipelineId: z.string().min(1),
  componentKeys: z.array(z.string()),
  limit: z.number().int().nonnegative(),
});

export const pendingActionSchema = z.object({
  type: z.string().min(1),
  targetVersion: z.string().min(1),
  downloadUrl: z.string().min(1),
  checksum: z.string().min(1),
});

export const pipelineConfigSchema = z.object({
  pipelineId: z.string().min(1),
  pipelineName: z.string().min(1),
  version: z.number().int().nonnegative(),
  configYaml: z.string(),
  checksum: z.string().min(1),
  logLevel: z.string().optional(),
  secrets: z.record(z.string(), z.string()).optional(),
  certFiles: z.array(certFileSchema).optional(),
});

export const configResponseSchema = z.object({
  pipelines: z.array(pipelineConfigSchema),
  pollIntervalMs: z.number().int().positive(),
  secretBackend: z.enum(["BUILTIN", "VAULT", "AWS_SM", "EXEC"]),
  secretBackendConfig: z.record(z.string(), z.unknown()).optional(),
  sampleRequests: z.array(sampleRequestSchema).optional(),
  pendingAction: pendingActionSchema.optional(),
  pushUrl: z.string().optional(),
});

export const componentMetricSchema = z.object({
  componentId: z.string().min(1),
  componentKind: z.string().min(1),
  receivedEvents: z.number(),
  sentEvents: z.number(),
  receivedBytes: z.number().optional(),
  sentBytes: z.number().optional(),
  errorsTotal: z.number().optional(),
  discardedEvents: z.number().optional(),
  latencyMeanSeconds: z.number().optional(),
});

export const pipelineStatusSchema = z.object({
  pipelineId: z.string().min(1),
  version: z.number().int().nonnegative(),
  status: z.enum(["RUNNING", "STARTING", "STOPPED", "CRASHED", "PENDING"]),
  pid: z.number().int().optional(),
  uptimeSeconds: z.number().optional(),
  eventsIn: z.number().optional(),
  eventsOut: z.number().optional(),
  errorsTotal: z.number().optional(),
  bytesIn: z.number().optional(),
  bytesOut: z.number().optional(),
  eventsDiscarded: z.number().optional(),
  componentMetrics: z.array(componentMetricSchema).optional(),
  utilization: z.number().optional(),
  recentLogs: z.array(z.string()).optional(),
  configChecksum: z.string().max(128).optional(),
});

export const hostMetricsSchema = z.object({
  memoryTotalBytes: z.number().optional(),
  memoryUsedBytes: z.number().optional(),
  memoryFreeBytes: z.number().optional(),
  cpuSecondsTotal: z.number().optional(),
  cpuSecondsIdle: z.number().optional(),
  loadAvg1: z.number().optional(),
  loadAvg5: z.number().optional(),
  loadAvg15: z.number().optional(),
  fsTotalBytes: z.number().optional(),
  fsUsedBytes: z.number().optional(),
  fsFreeBytes: z.number().optional(),
  diskReadBytes: z.number().optional(),
  diskWrittenBytes: z.number().optional(),
  netRxBytes: z.number().optional(),
  netTxBytes: z.number().optional(),
});

export const fieldInfoSchema = z.object({
  path: z.string(),
  type: z.string(),
  sample: z.string(),
});

export const sampleResultSchema = z.object({
  requestId: z.string().min(1),
  componentKey: z.string().optional(),
  events: z.array(z.unknown()).nullable().optional(),
  schema: z.array(fieldInfoSchema).nullable().optional(),
  error: z.string().optional(),
});

export const sampleResultSubmissionSchema = z.object({
  requestId: z.string().min(1),
  componentKey: z.string().min(1),
  events: z.array(z.unknown()).optional().default([]),
  schema: z.array(fieldInfoSchema).optional().default([]),
  error: z.string().optional(),
});

export const sampleResultsRequestSchema = z.object({
  results: z.array(sampleResultSubmissionSchema),
});

export const agentHealthSchema = z.object({
  pollErrorsTotal: z.number(),
  pushReconnectsTotal: z.number(),
  heartbeatErrorsTotal: z.number(),
  pushConnected: z.boolean(),
  pipelinesRunning: z.number().int(),
  uptimeSeconds: z.number(),
});

export const heartbeatRequestSchema = z.object({
  pipelines: z.array(pipelineStatusSchema),
  hostMetrics: hostMetricsSchema.optional(),
  agentVersion: z.string().max(100).optional(),
  vectorVersion: z.string().max(100).optional(),
  deploymentMode: deploymentModeSchema.optional(),
  runningAs: z.string().max(100).optional(),
  sampleResults: z.array(sampleResultSchema).nullable().optional(),
  updateError: z.string().max(500).optional(),
  labels: z.record(z.string(), z.string()).optional(),
  agentHealth: agentHealthSchema.optional(),
});

export const logBatchSchema = z.object({
  pipelineId: z.string().min(1),
  lines: z.array(z.string()).max(500),
});

export const logBatchesRequestSchema = z.array(logBatchSchema);

export const tapEventPayloadSchema = z.object({
  requestId: z.string().min(1),
  pipelineId: z.string().min(1),
  componentId: z.string().min(1),
  events: z.array(z.unknown()).optional(),
  status: z.enum(["stopped"]).optional(),
  reason: z.string().optional(),
});

export const configChangedPushMessageSchema = z.object({
  type: z.literal("config_changed"),
  pipelineId: z.string().optional(),
  reason: z.string().optional(),
});

export const sampleRequestPushMessageSchema = z.object({
  type: z.literal("sample_request"),
  requestId: z.string().min(1),
  pipelineId: z.string().min(1),
  componentKeys: z.array(z.string()),
  limit: z.number().int().nonnegative(),
});

export const actionPushMessageSchema = z.object({
  type: z.literal("action"),
  action: z.enum(["self_update", "restart"]),
  targetVersion: z.string().optional(),
  downloadUrl: z.string().optional(),
  checksum: z.string().optional(),
});

export const pollIntervalPushMessageSchema = z.object({
  type: z.literal("poll_interval"),
  intervalMs: z.number().int().positive(),
});

export const tapStartPushMessageSchema = z.object({
  type: z.literal("tap_start"),
  requestId: z.string().min(1),
  pipelineId: z.string().min(1),
  componentId: z.string().min(1),
});

export const tapStopPushMessageSchema = z.object({
  type: z.literal("tap_stop"),
  requestId: z.string().min(1),
});

export const pushMessageSchema = z.discriminatedUnion("type", [
  configChangedPushMessageSchema,
  sampleRequestPushMessageSchema,
  actionPushMessageSchema,
  pollIntervalPushMessageSchema,
  tapStartPushMessageSchema,
  tapStopPushMessageSchema,
]);

export const pushMessagesFixtureSchema = z.array(pushMessageSchema);

export type ConfigResponsePayload = z.infer<typeof configResponseSchema>;
export type HeartbeatRequestPayload = z.infer<typeof heartbeatRequestSchema>;
export type PipelineStatusPayload = z.infer<typeof pipelineStatusSchema>;
export type SampleResultPayload = z.infer<typeof sampleResultSchema>;
export type LogBatchPayload = z.infer<typeof logBatchSchema>;
export type SampleResultsRequestPayload = z.infer<typeof sampleResultsRequestSchema>;
export type TapEventPayload = z.infer<typeof tapEventPayloadSchema>;
export type PushMessagePayload = z.infer<typeof pushMessageSchema>;
