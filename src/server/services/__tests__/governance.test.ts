import { describe, expect, it } from "vitest";
import {
  buildComplianceReport,
  evaluateDestinationPolicy,
  summarizeGovernancePosture,
} from "@/server/services/governance";

const nodes = [
  {
    id: "source-1",
    componentKey: "source",
    displayName: "App logs",
    componentType: "file",
    kind: "SOURCE" as const,
    config: {},
  },
  {
    id: "dlp-1",
    componentKey: "redact_email",
    displayName: "Redact email",
    componentType: "dlp_email_redaction",
    kind: "TRANSFORM" as const,
    config: { fields: ["message", "user.email"] },
  },
  {
    id: "sink-1",
    componentKey: "warehouse",
    displayName: "Warehouse",
    componentType: "s3",
    kind: "SINK" as const,
    config: {},
  },
  {
    id: "sink-2",
    componentKey: "debug",
    displayName: "Debug stream",
    componentType: "console",
    kind: "SINK" as const,
    config: {},
  },
];

describe("buildComplianceReport", () => {
  it("reports DLP transforms that run before each sink", () => {
    const report = buildComplianceReport({
      pipelines: [
        {
          id: "pipeline-1",
          name: "Production logs",
          tags: ["PII", "GDPR"],
          nodes,
          edges: [
            { sourceNodeId: "source-1", targetNodeId: "dlp-1" },
            { sourceNodeId: "dlp-1", targetNodeId: "sink-1" },
            { sourceNodeId: "source-1", targetNodeId: "sink-2" },
          ],
        },
      ],
    });

    expect(report.summary).toEqual({
      pipelines: 1,
      sinks: 2,
      protectedSinks: 1,
      unprotectedSinks: 1,
      dlpTransforms: 1,
    });
    expect(report.pipelines[0].sinks).toEqual([
      expect.objectContaining({
        componentKey: "warehouse",
        protected: true,
        redactedFields: ["message", "user.email"],
        dlpTransforms: [
          expect.objectContaining({
            componentType: "dlp_email_redaction",
            complianceTags: ["GDPR", "HIPAA"],
          }),
        ],
      }),
      expect.objectContaining({
        componentKey: "debug",
        protected: false,
        redactedFields: [],
        dlpTransforms: [],
      }),
    ]);
  });

  it("uses template defaults when a DLP node has only VRL source config", () => {
    const report = buildComplianceReport({
      pipelines: [
        {
          id: "pipeline-1",
          name: "Production logs",
          tags: [],
          nodes: [
            { ...nodes[0] },
            {
              id: "dlp-1",
              componentKey: "redact_email",
              displayName: "Redact email",
              componentType: "dlp_email_redaction",
              kind: "TRANSFORM",
              config: { source: "fields = [\"message\"]" },
            },
            { ...nodes[2] },
          ],
          edges: [
            { sourceNodeId: "source-1", targetNodeId: "dlp-1" },
            { sourceNodeId: "dlp-1", targetNodeId: "sink-1" },
          ],
        },
      ],
    });

    expect(report.pipelines[0].sinks[0].redactedFields).toEqual([".message"]);
  });
});

describe("evaluateDestinationPolicy", () => {
  it("denies explicitly denied sinks before applying allow lists", () => {
    const results = evaluateDestinationPolicy({
      sinks: [
        { componentKey: "warehouse", componentType: "s3" },
        { componentKey: "debug", componentType: "console" },
        { componentKey: "search", componentType: "elasticsearch" },
      ],
      policy: {
        allowedSinkTypes: ["s3", "elasticsearch"],
        deniedSinkTypes: ["elasticsearch"],
      },
    });

    expect(results).toEqual([
      { componentKey: "warehouse", componentType: "s3", decision: "allow", reason: "Sink type is allowed by policy" },
      { componentKey: "debug", componentType: "console", decision: "deny", reason: "Sink type is not in the allow list" },
      { componentKey: "search", componentType: "elasticsearch", decision: "deny", reason: "Sink type is explicitly denied" },
    ]);
  });
});

describe("summarizeGovernancePosture", () => {
  it("rolls up identity, RBAC, audit, and DLP posture", () => {
    const posture = summarizeGovernancePosture({
      scimEnabled: true,
      oidcGroupSyncEnabled: false,
      auditLogCount: 12,
      auditShippingConfigured: true,
      totalUsers: 5,
      manuallyManagedUsers: 2,
      teamsWithAdmins: 3,
      totalTeams: 3,
      protectedSinks: 7,
      totalSinks: 10,
    });

    expect(posture.score).toBe(83);
    expect(posture.signals).toEqual([
      expect.objectContaining({ id: "identity", status: "healthy" }),
      expect.objectContaining({ id: "rbac", status: "warning" }),
      expect.objectContaining({ id: "audit", status: "healthy" }),
      expect.objectContaining({ id: "dlp", status: "warning" }),
    ]);
  });
});
