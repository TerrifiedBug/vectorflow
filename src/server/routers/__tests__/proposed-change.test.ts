import { vi, describe, it, expect, beforeEach } from "vitest";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@/generated/prisma";

const { t, prismaHolder } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { initTRPC } = require("@trpc/server");
  return {
    t: initTRPC.context().create(),
    prismaHolder: {} as { mock?: DeepMockProxy<PrismaClient> },
  };
});

vi.mock("@/trpc/init", () => {
  const passthrough = () =>
    t.middleware(({ next, ctx }: { next: (o: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx }));
  return {
    router: t.router,
    protectedProcedure: t.procedure,
    withTeamAccess: passthrough,
    requirePlatformOperator: passthrough,
    denyInDemo: passthrough,
    middleware: t.middleware,
  };
});

vi.mock("@/server/middleware/audit", () => ({
  withAudit: () =>
    t.middleware(({ next, ctx }: { next: (o: { ctx: unknown }) => unknown; ctx: unknown }) => next({ ctx })),
}));

vi.mock("@/lib/prisma", () => {
  const __pm = mockDeep<PrismaClient>();
  prismaHolder.mock = __pm;
  return { prisma: __pm, basePrisma: __pm, adminPrisma: __pm };
});

// Run the org transaction body directly against the prisma mock (tx === mock).
vi.mock("@/lib/with-org-tx", () => ({
  withOrgTx: (_orgId: string, fn: (tx: unknown) => unknown) => fn(prismaHolder.mock),
}));

vi.mock("@/server/services/ai", () => ({ completeChat: vi.fn() }));
vi.mock("@/server/services/validator", () => ({ validateConfig: vi.fn() }));
vi.mock("@/server/services/transform-eval", () => ({ evaluateVrl: vi.fn() }));
vi.mock("@/lib/config-generator", () => ({ generateVectorYaml: vi.fn(() => "rendered: yaml") }));
vi.mock("@/server/services/pipeline-graph", () => ({ saveGraphComponents: vi.fn() }));
vi.mock("@/server/services/config-crypto", () => ({
  encryptNodeConfig: (_type: string, config: unknown) => config,
  decryptNodeConfig: (_type: string, config: unknown) => config,
}));
vi.mock("@/server/services/pipeline-version", () => ({ deployFromVersion: vi.fn() }));
vi.mock("@/server/services/staged-rollout", () => ({ stagedRolloutService: { rollbackRollout: vi.fn() } }));

import { proposedChangeRouter } from "@/server/routers/proposed-change";
import { completeChat } from "@/server/services/ai";
import { validateConfig } from "@/server/services/validator";
import { evaluateVrl } from "@/server/services/transform-eval";
import { generateVectorYaml } from "@/lib/config-generator";
import { saveGraphComponents } from "@/server/services/pipeline-graph";
import { deployFromVersion } from "@/server/services/pipeline-version";
import { stagedRolloutService } from "@/server/services/staged-rollout";
import { prisma } from "@/lib/prisma";

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const db = prismaMock;
const completeChatMock = vi.mocked(completeChat);
const validateConfigMock = vi.mocked(validateConfig);
const evaluateVrlMock = vi.mocked(evaluateVrl);
const saveGraphMock = vi.mocked(saveGraphComponents);
const deployFromVersionMock = vi.mocked(deployFromVersion);
const rollbackRolloutMock = vi.mocked(stagedRolloutService.rollbackRollout);
const generateVectorYamlMock = vi.mocked(generateVectorYaml);

const appRouter = t.router({ proposedChange: proposedChangeRouter });
const caller = t.createCallerFactory(appRouter)({
  session: { user: { id: "user-1", email: "u@test.com", name: "User" } },
  userRole: "ADMIN",
  teamId: "team-1",
  organizationId: "org-1",
});

const ONSET = new Date("2026-03-01T12:00:00Z");

function okVrlResult() {
  return { inputCount: 1, outputCount: 1, droppedCount: 0, inputBytes: 10, outputBytes: 10, eventReductionPercent: 0, byteReductionPercent: 0, outputs: [{}], durationMs: 1 };
}
function errVrlResult(error: string) {
  return { inputCount: 1, outputCount: 0, droppedCount: 1, inputBytes: 10, outputBytes: 0, eventReductionPercent: 100, byteReductionPercent: 100, outputs: [], error, durationMs: 1 };
}

/** Read the `data` object passed to the most recent proposedChange.create call. */
function lastCreatedData(): Record<string, unknown> {
  const calls = db.proposedChange.create.mock.calls;
  const call = calls[calls.length - 1];
  return (call![0] as { data: Record<string, unknown> }).data;
}

const GRAPH_NODES = [
  {
    id: "n1",
    componentKey: "in",
    componentType: "demo_logs",
    kind: "SOURCE",
    config: { format: "json" },
    positionX: 0,
    positionY: 0,
    disabled: false,
  },
];

beforeEach(() => {
  mockReset(prismaMock);
  vi.clearAllMocks();
  generateVectorYamlMock.mockReturnValue("rendered: yaml");
  db.team.findUnique.mockResolvedValue({ aiEnabled: true, aiApiKey: "enc:key" } as never);
  db.pipeline.findFirst.mockResolvedValue({ id: "pipe-1" } as never);
  db.proposedChange.create.mockResolvedValue({ id: "pc-1" } as never);
});

describe("proposedChange.propose", () => {
  it("gates on the team BYO AI key", async () => {
    db.team.findUnique.mockResolvedValue({ aiEnabled: false, aiApiKey: null } as never);
    await expect(
      caller.proposedChange.propose({
        pipelineId: "pipe-1",
        kind: "VRL",
        targetComponentKey: "remap_1",
        vrlSource: ".x = 1",
      }),
    ).rejects.toThrow(/AI is not enabled/);
    expect(db.proposedChange.create).not.toHaveBeenCalled();
  });

  it("stages a valid VRL change as PENDING + validated", async () => {
    evaluateVrlMock.mockResolvedValue(okVrlResult() as never);

    await caller.proposedChange.propose({
      pipelineId: "pipe-1",
      kind: "VRL",
      targetComponentKey: "remap_1",
      vrlSource: ".level = downcase(.level)",
    });

    const data = lastCreatedData();
    expect(data.status).toBe("PENDING");
    expect(data.validated).toBe(true);
    expect(data.vrlSource).toBe(".level = downcase(.level)");
    expect(completeChatMock).not.toHaveBeenCalled();
    expect((data.validationResult as { autoFixAttempts: number }).autoFixAttempts).toBe(0);
  });

  it("runs a bounded auto-fix loop and stages the repaired VRL when it validates", async () => {
    evaluateVrlMock
      .mockResolvedValueOnce(errVrlResult("error: function 'downcase' undefined") as never)
      .mockResolvedValueOnce(okVrlResult() as never);
    completeChatMock.mockResolvedValue("```vrl\n.level = downcase!(.level)\n```");

    await caller.proposedChange.propose({
      pipelineId: "pipe-1",
      kind: "VRL",
      targetComponentKey: "remap_1",
      vrlSource: ".level = downcase(.level)",
      prompt: "lowercase the level",
    });

    const data = lastCreatedData();
    expect(completeChatMock).toHaveBeenCalledTimes(1);
    expect(data.validated).toBe(true);
    expect(data.vrlSource).toBe(".level = downcase!(.level)");
    expect((data.validationResult as { autoFixAttempts: number }).autoFixAttempts).toBe(1);
  });

  it("stages an invalid VRL change as PENDING with validated=false after exhausting auto-fix", async () => {
    evaluateVrlMock.mockResolvedValue(errVrlResult("error: still broken") as never);
    completeChatMock.mockResolvedValue("still broken");

    await caller.proposedChange.propose({
      pipelineId: "pipe-1",
      kind: "VRL",
      targetComponentKey: "remap_1",
      vrlSource: ".bad",
    });

    const data = lastCreatedData();
    expect(data.status).toBe("PENDING");
    expect(data.validated).toBe(false);
    expect(completeChatMock).toHaveBeenCalledTimes(2);
    const vr = data.validationResult as { valid: boolean; error: string; autoFixAttempts: number };
    expect(vr.valid).toBe(false);
    expect(vr.error).toContain("still broken");
    expect(vr.autoFixAttempts).toBe(2);
  });

  it("stages a valid PIPELINE_GRAPH change", async () => {
    validateConfigMock.mockResolvedValue({ valid: true, errors: [], warnings: [] });

    await caller.proposedChange.propose({
      pipelineId: "pipe-1",
      kind: "PIPELINE_GRAPH",
      proposedNodes: GRAPH_NODES,
      proposedEdges: [],
    });

    const data = lastCreatedData();
    expect(data.kind).toBe("PIPELINE_GRAPH");
    expect(data.validated).toBe(true);
    expect(generateVectorYamlMock).toHaveBeenCalled();
    expect(validateConfigMock).toHaveBeenCalledWith("rendered: yaml");
  });
});

describe("proposedChange.approve", () => {
  it("refuses to apply an unvalidated change", async () => {
    db.proposedChange.findFirst.mockResolvedValue({
      id: "pc-1",
      pipelineId: "pipe-1",
      status: "PENDING",
      validated: false,
      kind: "VRL",
    } as never);

    await expect(
      caller.proposedChange.approve({ pipelineId: "pipe-1", changeId: "pc-1" }),
    ).rejects.toThrow(/failed validation/);
    expect(saveGraphMock).not.toHaveBeenCalled();
    expect(db.proposedChange.update).not.toHaveBeenCalled();
  });

  it("applies a validated PIPELINE_GRAPH change to the draft and marks it APPLIED", async () => {
    db.proposedChange.findFirst.mockResolvedValue({
      id: "pc-1",
      pipelineId: "pipe-1",
      status: "PENDING",
      validated: true,
      kind: "PIPELINE_GRAPH",
      proposedNodes: GRAPH_NODES,
      proposedEdges: [],
      proposedGlobalConfig: null,
      targetComponentKey: null,
      vrlSource: null,
    } as never);
    db.proposedChange.update.mockResolvedValue({ id: "pc-1", status: "APPLIED" } as never);

    const res = await caller.proposedChange.approve({ pipelineId: "pipe-1", changeId: "pc-1" });

    expect(saveGraphMock).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ pipelineId: "pipe-1", nodes: GRAPH_NODES, edges: [], userId: "user-1" }),
    );
    expect(db.proposedChange.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pc-1" },
        data: expect.objectContaining({ status: "APPLIED" }),
      }),
    );
    expect((res as { status: string }).status).toBe("APPLIED");
  });

  it("normalizes id-less proposed nodes and rewrites edges by component key before saving", async () => {
    db.proposedChange.findFirst.mockResolvedValue({
      id: "pc-3",
      pipelineId: "pipe-1",
      status: "PENDING",
      validated: true,
      kind: "PIPELINE_GRAPH",
      proposedNodes: [
        { componentKey: "in", componentType: "demo_logs", kind: "SOURCE", config: {}, positionX: 0, positionY: 0, disabled: false },
        { componentKey: "out", componentType: "console", kind: "SINK", config: {}, positionX: 1, positionY: 0, disabled: false },
      ],
      proposedEdges: [{ sourceNodeId: "in", targetNodeId: "out" }],
      proposedGlobalConfig: null,
      targetComponentKey: null,
      vrlSource: null,
    } as never);
    db.proposedChange.update.mockResolvedValue({ id: "pc-3", status: "APPLIED" } as never);

    await caller.proposedChange.approve({ pipelineId: "pipe-1", changeId: "pc-3" });

    const [, params] = saveGraphMock.mock.calls.at(-1)!;
    const nodes = (params as { nodes: Array<{ id: string; componentKey: string }> }).nodes;
    const edges = (params as { edges: Array<{ sourceNodeId: string; targetNodeId: string }> }).edges;
    // Every saved node has a concrete id…
    expect(nodes.every((n) => typeof n.id === "string" && n.id.length > 0)).toBe(true);
    // …and the edge endpoints now point at those ids, not the component keys.
    const idOf = (key: string) => nodes.find((n) => n.componentKey === key)!.id;
    expect(edges[0].sourceNodeId).toBe(idOf("in"));
    expect(edges[0].targetNodeId).toBe(idOf("out"));
  });

  it("applies a validated VRL change by setting the target component's source", async () => {
    db.proposedChange.findFirst.mockResolvedValue({
      id: "pc-2",
      pipelineId: "pipe-1",
      status: "PENDING",
      validated: true,
      kind: "VRL",
      targetComponentKey: "remap_1",
      vrlSource: ".keep = true",
      proposedNodes: null,
      proposedEdges: null,
      proposedGlobalConfig: null,
    } as never);
    db.pipelineNode.findFirst.mockResolvedValue({
      id: "node-9",
      componentType: "remap",
      config: { source: ".old = 1" },
    } as never);
    db.pipelineNode.update.mockResolvedValue({} as never);
    db.pipeline.update.mockResolvedValue({} as never);
    db.proposedChange.update.mockResolvedValue({ id: "pc-2", status: "APPLIED" } as never);

    await caller.proposedChange.approve({ pipelineId: "pipe-1", changeId: "pc-2" });

    expect(db.pipelineNode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "node-9" },
        data: { config: { source: ".keep = true" } },
      }),
    );
    expect(saveGraphMock).not.toHaveBeenCalled();
  });

  it("rejects approving an already-reviewed change", async () => {
    db.proposedChange.findFirst.mockResolvedValue({
      id: "pc-1",
      pipelineId: "pipe-1",
      status: "APPLIED",
      validated: true,
      kind: "VRL",
    } as never);
    await expect(
      caller.proposedChange.approve({ pipelineId: "pipe-1", changeId: "pc-1" }),
    ).rejects.toThrow(/already applied/);
  });
});

describe("proposedChange.reject", () => {
  it("marks a PENDING change REJECTED with a note", async () => {
    db.proposedChange.findFirst.mockResolvedValue({ id: "pc-1", status: "PENDING" } as never);
    db.proposedChange.update.mockResolvedValue({ id: "pc-1", status: "REJECTED" } as never);

    await caller.proposedChange.reject({ pipelineId: "pipe-1", changeId: "pc-1", reviewNote: "not safe" });

    expect(db.proposedChange.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pc-1" },
        data: expect.objectContaining({ status: "REJECTED", reviewNote: "not safe" }),
      }),
    );
  });
});

describe("proposedChange.incidentCopilot", () => {
  it("proposes a rollback against a seeded anomaly+release timeline", async () => {
    db.anomalyEvent.findMany.mockResolvedValue([
      {
        id: "anom-1",
        pipelineId: "pipe-1",
        environmentId: "env-1",
        metricName: "eventsIn",
        severity: "critical",
        message: "throughput dropped",
        status: "open",
        detectedAt: ONSET,
      },
    ] as never);
    db.release.findMany.mockResolvedValue([
      {
        id: "rel-1",
        strategy: "DIRECT",
        status: "DEPLOYED",
        pipelineId: "pipe-1",
        environmentId: "env-1",
        changelog: "ship",
        deployedAt: new Date(ONSET.getTime() - 8 * 60_000),
        createdAt: new Date(ONSET.getTime() - 9 * 60_000),
      },
    ] as never);

    const res = await caller.proposedChange.incidentCopilot({ pipelineId: "pipe-1" });

    expect(res.suggestedAction).toMatchObject({
      type: "rollback",
      releaseId: "rel-1",
      strategy: "DIRECT",
      pipelineId: "pipe-1",
      anomalyId: "anom-1",
    });
  });

  it("proposes no action when nothing correlates", async () => {
    db.anomalyEvent.findMany.mockResolvedValue([] as never);
    db.release.findMany.mockResolvedValue([] as never);

    const res = await caller.proposedChange.incidentCopilot({ environmentId: "env-1" });
    expect(res.suggestedAction).toEqual({ type: "none" });
  });
});

describe("proposedChange.applyIncidentAction", () => {
  it("dispatches a CANARY rollback to the staged-rollout service", async () => {
    db.release.findFirst.mockResolvedValue({
      id: "rel-canary",
      strategy: "CANARY",
      pipelineId: "pipe-1",
      deployedAt: ONSET,
      createdAt: ONSET,
    } as never);
    rollbackRolloutMock.mockResolvedValue(undefined);

    const res = await caller.proposedChange.applyIncidentAction({ pipelineId: "pipe-1", releaseId: "rel-canary" });

    expect(rollbackRolloutMock).toHaveBeenCalledWith("rel-canary");
    expect(deployFromVersionMock).not.toHaveBeenCalled();
    expect(res).toMatchObject({ strategy: "CANARY", rolledBack: true });
  });

  it("dispatches a DIRECT rollback by redeploying the prior version", async () => {
    db.release.findFirst.mockResolvedValue({
      id: "rel-direct",
      strategy: "DIRECT",
      pipelineId: "pipe-1",
      deployedAt: ONSET,
      createdAt: ONSET,
    } as never);
    db.pipelineVersion.findFirst.mockResolvedValue({ id: "v-prior", version: 4 } as never);
    deployFromVersionMock.mockResolvedValue({ version: { version: 5 }, pushedNodeIds: [] } as never);

    const res = await caller.proposedChange.applyIncidentAction({ pipelineId: "pipe-1", releaseId: "rel-direct" });

    expect(deployFromVersionMock).toHaveBeenCalledWith(
      "pipe-1",
      "v-prior",
      "user-1",
      expect.stringContaining("Incident rollback"),
    );
    expect(rollbackRolloutMock).not.toHaveBeenCalled();
    expect(res).toMatchObject({ strategy: "DIRECT", rolledBack: true });
  });

  it("refuses a DIRECT rollback when there is no prior version", async () => {
    db.release.findFirst.mockResolvedValue({
      id: "rel-direct",
      strategy: "DIRECT",
      pipelineId: "pipe-1",
      deployedAt: ONSET,
      createdAt: ONSET,
    } as never);
    db.pipelineVersion.findFirst.mockResolvedValue(null as never);

    await expect(
      caller.proposedChange.applyIncidentAction({ pipelineId: "pipe-1", releaseId: "rel-direct" }),
    ).rejects.toThrow(/No prior version/);
  });
});
