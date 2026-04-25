import { describe, it, expect } from "vitest";
import { buildHeartbeatPayload } from "../telemetry-payload";

const fixedDate = new Date("2026-04-25T10:00:00.000Z");

describe("buildHeartbeatPayload", () => {
  it("emits all required V1 fields", () => {
    const payload = buildHeartbeatPayload({
      instanceId: "01HX0000000000000000000000",
      enabledAt: fixedDate,
      vfVersion: "1.4.2",
      agentCount: 5,
      pipelineCount: { active: 12, paused: 2, draft: 3 },
      authMethod: "credentials",
      deploymentMode: "docker",
    });

    expect(payload.schema_version).toBe(1);
    expect(payload.instance_id).toBe("01HX0000000000000000000000");
    expect(payload.instance_created_at).toBe(fixedDate.toISOString());
    expect(payload.vf_version).toBe("1.4.2");
    expect(payload.agent_count).toBe(5);
    expect(payload.pipeline_count).toEqual({ active: 12, paused: 2, draft: 3 });
    expect(payload.auth_method).toBe("credentials");
    expect(payload.deployment_mode).toBe("docker");
    expect(payload.sent_at).toBeTypeOf("string");
    expect(new Date(payload.sent_at).toString()).not.toBe("Invalid Date");
  });

  it("supports oidc auth_method", () => {
    const payload = buildHeartbeatPayload({
      instanceId: "01HX0000000000000000000000",
      enabledAt: fixedDate,
      vfVersion: "1.4.2",
      agentCount: 0,
      pipelineCount: { active: 0, paused: 0, draft: 0 },
      authMethod: "oidc",
      deploymentMode: "helm",
    });
    expect(payload.auth_method).toBe("oidc");
    expect(payload.deployment_mode).toBe("helm");
  });

  it("accepts deployment_mode unknown", () => {
    const payload = buildHeartbeatPayload({
      instanceId: "01HX0000000000000000000000",
      enabledAt: fixedDate,
      vfVersion: "unknown",
      agentCount: 0,
      pipelineCount: { active: 0, paused: 0, draft: 0 },
      authMethod: "credentials",
      deploymentMode: "unknown",
    });
    expect(payload.deployment_mode).toBe("unknown");
    expect(payload.vf_version).toBe("unknown");
  });
});
