import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

const { t } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  const t = initTRPC.context().create();
  return { t };
});

vi.mock("@/trpc/init", () => {
  const passthrough = () =>
    t.middleware(({ next, ctx }: { next: (opts: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx }));
  return {
    router: t.router,
    protectedProcedure: t.procedure,
    withTeamAccess: passthrough,
    middleware: t.middleware,
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: mockDeep<PrismaClient>(),
}));

import { prisma } from "@/lib/prisma";
import { governanceRouter } from "@/server/routers/governance";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const caller = t.createCallerFactory(governanceRouter)({
  session: { user: { id: "user-1" } },
});

describe("governanceRouter", () => {
  beforeEach(() => {
    mockReset(prismaMock);
  });

  it("returns compliance report and posture for a team", async () => {
    prismaMock.pipeline.findMany.mockResolvedValue([
      {
        id: "pipeline-1",
        name: "Production logs",
        tags: ["PII"],
        nodes: [
          {
            id: "source-1",
            componentKey: "source",
            displayName: null,
            componentType: "file",
            kind: "SOURCE",
            config: {},
          },
          {
            id: "dlp-1",
            componentKey: "redact_email",
            displayName: null,
            componentType: "dlp_email_redaction",
            kind: "TRANSFORM",
            config: { fields: ["message"] },
          },
          {
            id: "sink-1",
            componentKey: "warehouse",
            displayName: null,
            componentType: "s3",
            kind: "SINK",
            config: {},
          },
        ],
        edges: [{ sourceNodeId: "source-1", targetNodeId: "dlp-1" }, { sourceNodeId: "dlp-1", targetNodeId: "sink-1" }],
      },
    ] as never);
    prismaMock.systemSettings.findUnique.mockResolvedValue({ scimEnabled: true, oidcGroupSyncEnabled: false } as never);
    prismaMock.auditLog.count.mockResolvedValue(3);
    prismaMock.pipeline.findFirst.mockResolvedValue({ id: "system-pipeline", isDraft: false, deployedAt: new Date("2026-01-01") } as never);
    prismaMock.teamMember.findMany.mockResolvedValue([
      { role: "ADMIN", user: { scimExternalId: "scim-1", authMethod: "OIDC" } },
      { role: "VIEWER", user: { scimExternalId: null, authMethod: "PASSWORD" } },
    ] as never);

    const result = await caller.report({ teamId: "team-1" });

    expect(result.compliance.summary.protectedSinks).toBe(1);
    expect(result.posture.signals.map((signal: { id: string }) => signal.id)).toEqual(["identity", "rbac", "audit", "dlp"]);
    expect(prismaMock.pipeline.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { environment: { teamId: "team-1" } },
      }),
    );
  });

  it("reports audit shipping not configured when system pipeline is a draft", async () => {
    prismaMock.pipeline.findMany.mockResolvedValue([] as never);
    prismaMock.systemSettings.findUnique.mockResolvedValue({ scimEnabled: false, oidcGroupSyncEnabled: false } as never);
    prismaMock.auditLog.count.mockResolvedValue(5);
    prismaMock.pipeline.findFirst.mockResolvedValue(null as never); // draft pipeline filtered out
    prismaMock.teamMember.findMany.mockResolvedValue([
      { role: "ADMIN", user: { scimExternalId: null, authMethod: "PASSWORD" } },
    ] as never);

    const result = await caller.report({ teamId: "team-1" });

    const auditSignal = result.posture.signals.find((s: { id: string }) => s.id === "audit");
    expect(auditSignal?.status).toBe("warning");
  });

  it("previews destination policy decisions for a pipeline", async () => {
    prismaMock.pipeline.findUnique.mockResolvedValue({
      id: "pipeline-1",
      nodes: [
        {
          id: "sink-1",
          componentKey: "warehouse",
          displayName: null,
          componentType: "s3",
          kind: "SINK",
          config: {},
        },
        {
          id: "sink-2",
          componentKey: "debug",
          displayName: null,
          componentType: "console",
          kind: "SINK",
          config: {},
        },
      ],
    } as never);

    const result = await caller.previewDestinationPolicy({
      pipelineId: "pipeline-1",
      allowedSinkTypes: ["s3"],
    });

    expect(result.decisions).toEqual([
      expect.objectContaining({ componentKey: "warehouse", decision: "allow" }),
      expect.objectContaining({ componentKey: "debug", decision: "deny" }),
    ]);
  });
});
