export interface BuildPayloadInput {
  instanceId: string;
  enabledAt: Date;
  vfVersion: string;
  agentCount: number;
  pipelineCount: { active: number; paused: number; draft: number };
  authMethod: "credentials" | "oidc";
  deploymentMode: "docker" | "helm" | "bare" | "unknown";
}

export interface HeartbeatPayloadV1 {
  schema_version: 1;
  instance_id: string;
  instance_created_at: string;
  sent_at: string;
  vf_version: string;
  agent_count: number;
  pipeline_count: { active: number; paused: number; draft: number };
  auth_method: "credentials" | "oidc";
  deployment_mode: "docker" | "helm" | "bare" | "unknown";
}

export function buildHeartbeatPayload(input: BuildPayloadInput): HeartbeatPayloadV1 {
  return {
    schema_version: 1,
    instance_id: input.instanceId,
    instance_created_at: input.enabledAt.toISOString(),
    sent_at: new Date().toISOString(),
    vf_version: input.vfVersion,
    agent_count: input.agentCount,
    pipeline_count: input.pipelineCount,
    auth_method: input.authMethod,
    deployment_mode: input.deploymentMode,
  };
}
